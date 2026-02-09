const Anthropic = require('@anthropic-ai/sdk');
const { trackApiUsage } = require('./api-usage');

/**
 * Generate a dashboard specification from a natural language description
 * @param {string} description - User's description of desired dashboard
 * @param {string} schemaContext - Rich schema context from data source
 * @param {string} tenantId - Tenant ID for credit tracking
 * @returns {Object} Dashboard specification with widgets
 */
async function generateDashboardSpec(description, schemaContext, tenantId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `You are building a dashboard for a business intelligence tool. Based on the user's description and the available data, generate a dashboard specification.

AVAILABLE DATA:
${schemaContext}

Generate a dashboard with 4-8 widgets. Respond ONLY with valid JSON in this exact format:
{
  "dashboard_name": "Dashboard title",
  "dashboard_description": "One sentence description",
  "widgets": [
    {
      "question": "The natural language question to ask",
      "suggested_viz": "bar_chart|line_chart|pie_chart|single_number|table|area_chart|scatter_plot|heatmap|grouped_bar_chart",
      "size": "small|medium|large|full_width",
      "position_hint": "top_left|top_right|top_center|middle_left|middle_right|bottom_left|bottom_right|bottom_center"
    }
  ]
}

RULES:
1. Start with 1-2 single_number KPI widgets at the top (total revenue, total orders, etc.)
2. Include at least one time-trend chart if date data is available
3. Include at least one ranking/comparison chart
4. Include at least one breakdown/composition chart (pie or grouped bar)
5. Vary visualization types — don't make every widget a bar chart
6. Size guide: single_number = small, KPI charts = medium, detailed tables = large, primary charts = large or full_width
7. Questions must reference actual tables and columns from the schema
8. Aim for a balanced, visually pleasing layout
9. Respond with ONLY the JSON object, no additional text or markdown`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: description
        }
      ]
    });

    // Track API usage
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    await trackApiUsage(tenantId, inputTokens, outputTokens, 'dashboard_generation');

    const responseText = message.content[0].text.trim();

    // Try to extract JSON from the response (in case Claude wrapped it in markdown)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    } else {
      // Try to find JSON object in the text
      const objMatch = responseText.match(/\{[\s\S]*\}/);
      if (objMatch) {
        jsonText = objMatch[0];
      }
    }

    const spec = JSON.parse(jsonText);

    // Validate the spec
    if (!spec.dashboard_name || !spec.widgets || !Array.isArray(spec.widgets)) {
      throw new Error('Invalid dashboard specification format');
    }

    if (spec.widgets.length < 4 || spec.widgets.length > 8) {
      throw new Error('Dashboard must have between 4 and 8 widgets');
    }

    // Validate each widget
    for (const widget of spec.widgets) {
      if (!widget.question || !widget.suggested_viz || !widget.size || !widget.position_hint) {
        throw new Error('Each widget must have question, suggested_viz, size, and position_hint');
      }
    }

    return {
      success: true,
      spec,
      tokensUsed: { input: inputTokens, output: outputTokens }
    };

  } catch (err) {
    console.error('Dashboard generation error:', err);
    throw new Error(`Failed to generate dashboard: ${err.message}`);
  }
}

/**
 * Generate suggested dashboard prompts based on schema
 * @param {string} schemaContext - Rich schema context from data source
 * @returns {Array<string>} Array of 3 suggested prompts
 */
async function generateSuggestedPrompts(schemaContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Return generic prompts if API key not available
    return [
      "A comprehensive overview showing key metrics and trends",
      "Performance analysis with comparisons over time",
      "Detailed breakdown by category with top performers"
    ];
  }

  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `Based on the data schema provided, suggest 3 specific dashboard prompts that would be useful for this data. Each prompt should be 8-15 words describing a specific analytical dashboard.

AVAILABLE DATA:
${schemaContext}

Respond with ONLY a JSON array of 3 strings, like:
["First dashboard prompt", "Second dashboard prompt", "Third dashboard prompt"]`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: 'Generate 3 suggested dashboard prompts for this data'
        }
      ]
    });

    const responseText = message.content[0].text.trim();

    // Try to extract JSON array
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    } else {
      const arrMatch = responseText.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        jsonText = arrMatch[0];
      }
    }

    const prompts = JSON.parse(jsonText);

    if (!Array.isArray(prompts) || prompts.length !== 3) {
      throw new Error('Invalid prompts format');
    }

    return prompts;

  } catch (err) {
    console.error('Suggested prompts generation error:', err);
    // Return generic fallbacks
    return [
      "A comprehensive overview showing key metrics and trends",
      "Performance analysis with comparisons over time",
      "Detailed breakdown by category with top performers"
    ];
  }
}

/**
 * Convert position hints and sizes to grid coordinates
 * @param {Array} widgets - Widget specs with position hints
 * @returns {Array} Widgets with grid positions {x, y, w, h}
 */
function assignGridPositions(widgets) {
  // Grid is 12 columns wide
  const GRID_COLS = 12;

  // Size mappings to width (in grid columns)
  const sizeToWidth = {
    'small': 3,
    'medium': 6,
    'large': 6,
    'full_width': 12
  };

  // Size mappings to height (in grid rows)
  const sizeToHeight = {
    'small': 4,
    'medium': 6,
    'large': 8,
    'full_width': 8
  };

  // Track current position in the grid
  let currentRow = 0;
  let currentCol = 0;

  // Position hints to preferred column
  const positionToCol = {
    'top_left': 0,
    'top_center': 3,
    'top_right': 6,
    'middle_left': 0,
    'middle_right': 6,
    'bottom_left': 0,
    'bottom_center': 3,
    'bottom_right': 6
  };

  const result = [];

  // First pass: place widgets based on hints
  for (const widget of widgets) {
    const w = sizeToWidth[widget.size] || 6;
    const h = sizeToHeight[widget.size] || 6;

    // Determine starting column based on position hint
    let preferredCol = positionToCol[widget.position_hint] || 0;

    // If widget is full width, always start at column 0
    if (widget.size === 'full_width') {
      preferredCol = 0;
    }

    // Check if widget fits in current row
    if (currentCol + w > GRID_COLS) {
      // Move to next row
      currentRow += Math.max(...result.filter(r => r.y === currentRow).map(r => r.h), 6);
      currentCol = preferredCol;
    } else if (currentCol < preferredCol && currentCol + w <= preferredCol) {
      // Can shift to preferred column
      currentCol = preferredCol;
    }

    // Ensure we don't go past grid width
    if (currentCol + w > GRID_COLS) {
      currentRow += Math.max(...result.filter(r => r.y === currentRow).map(r => r.h), 6);
      currentCol = 0;
    }

    result.push({
      ...widget,
      position: {
        x: currentCol,
        y: currentRow,
        w: w,
        h: h
      }
    });

    // Move current position
    currentCol += w;
  }

  return result;
}

module.exports = {
  generateDashboardSpec,
  generateSuggestedPrompts,
  assignGridPositions
};
