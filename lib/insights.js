const Anthropic = require('@anthropic-ai/sdk');

/**
 * Insight Generation Module
 *
 * Generates AI-powered business insights from query results using Claude.
 */

// System prompt for insight generation
const INSIGHT_SYSTEM_PROMPT = `You are a senior business analyst reviewing query results. Analyze the data and provide 2-4 concise, actionable business insights.

DATA CONTEXT:
User asked: "{question}"
Query returned {row_count} rows with columns: {column_names}

RESULTS:
{formatted_results}

SCHEMA CONTEXT:
{schema_context}

For each insight, respond in this exact JSON format:
[
  {
    "type": "anomaly|trend|opportunity|warning|correlation",
    "severity": "info|warning|critical|opportunity",
    "title": "Short headline (max 80 chars)",
    "description": "2-3 sentence explanation with specific numbers from the data. Be concrete, not vague. Reference actual values.",
    "evidence": {"metric": "value", "comparison": "value", "delta": "value or percentage"}
  }
]

RULES:
1. Be specific — cite actual numbers from the results. "Revenue is $1.2M" not "Revenue is high."
2. Look for: outliers, concentration risks (one customer = 40% of revenue), trends, missing data patterns, suspicious values, growth/decline rates, Pareto distributions (80/20 rule).
3. Compare against business common sense — if average order is $3, that's unusual for B2B. If one region has 10x the others, flag it.
4. Severity guide: "critical" = needs immediate attention (data anomaly, huge drop). "warning" = should investigate. "opportunity" = potential upside. "info" = interesting observation.
5. If the data is too simple or small for meaningful insights (e.g., a simple count), return 1 insight maximum.
6. Do NOT hallucinate data that isn't in the results. Only reference actual values returned.

Respond ONLY with valid JSON array. No markdown code blocks, no explanation text, just the JSON.`;

/**
 * Format results for the insight prompt
 * @param {Array} columns - Column names
 * @param {Array} rows - Data rows
 * @param {number} maxRows - Maximum rows to include
 * @returns {string} Formatted results string
 */
function formatResultsForPrompt(columns, rows, maxRows = 200) {
  const displayRows = rows.slice(0, maxRows);

  // Create a compact table representation
  const headerLine = columns.join(' | ');
  const separator = columns.map(() => '---').join(' | ');

  const dataLines = displayRows.map(row =>
    columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') {
        return Number.isInteger(val) ? val.toString() : val.toFixed(2);
      }
      const str = String(val);
      return str.length > 50 ? str.substring(0, 47) + '...' : str;
    }).join(' | ')
  );

  let result = `${headerLine}\n${separator}\n${dataLines.join('\n')}`;

  if (rows.length > maxRows) {
    result += `\n... (${rows.length - maxRows} more rows truncated)`;
  }

  return result;
}

/**
 * Parse insight response from Claude
 * @param {string} response - Raw response from Claude
 * @returns {Array} Parsed insights array
 */
function parseInsightResponse(response) {
  try {
    // Clean up any potential markdown or extra text
    let cleaned = response.trim();

    // Remove markdown code blocks if present
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    // Find the JSON array in the response
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      console.error('No JSON array found in insight response');
      return [];
    }

    const insights = JSON.parse(arrayMatch[0]);

    // Validate and sanitize each insight
    return insights.map(insight => ({
      type: ['anomaly', 'trend', 'opportunity', 'warning', 'correlation'].includes(insight.type)
        ? insight.type : 'info',
      severity: ['info', 'warning', 'critical', 'opportunity'].includes(insight.severity)
        ? insight.severity : 'info',
      title: String(insight.title || '').substring(0, 80),
      description: String(insight.description || '').substring(0, 500),
      evidence: insight.evidence || {}
    })).slice(0, 4); // Max 4 insights

  } catch (err) {
    console.error('Error parsing insight response:', err);
    return [];
  }
}

/**
 * Generate insights from query results
 * @param {object} options - Options object
 * @param {string} options.question - The user's original question
 * @param {string} options.sql - The SQL that was executed
 * @param {Array} options.columns - Column names
 * @param {Array} options.rows - Result rows
 * @param {string} options.schemaContext - Schema context for the data source
 * @returns {Promise<object>} { insights: Array, usage: { inputTokens, outputTokens } }
 */
async function generateInsights({ question, sql, columns, rows, schemaContext }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { insights: [], usage: null, error: 'API key not configured' };
  }

  // Skip insight generation for very simple results
  if (rows.length === 0) {
    return { insights: [], usage: null };
  }

  // Build the prompt
  const formattedResults = formatResultsForPrompt(columns, rows);
  const prompt = INSIGHT_SYSTEM_PROMPT
    .replace('{question}', question)
    .replace('{row_count}', rows.length.toString())
    .replace('{column_names}', columns.join(', '))
    .replace('{formatted_results}', formattedResults)
    .replace('{schema_context}', schemaContext || 'No schema context available');

  try {
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      temperature: 0.3,
      system: 'You are a data analyst. Respond only with valid JSON.',
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    const responseText = message.content[0].text;
    const insights = parseInsightResponse(responseText);

    return {
      insights,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens
      }
    };

  } catch (err) {
    console.error('Insight generation error:', err);
    return {
      insights: [],
      usage: null,
      error: err.message
    };
  }
}

module.exports = {
  generateInsights,
  formatResultsForPrompt,
  parseInsightResponse
};
