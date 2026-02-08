const Anthropic = require('@anthropic-ai/sdk');

/**
 * Natural Language Query Module
 *
 * Handles AI-powered data querying using Claude to generate SQL from natural language.
 */

// Dangerous SQL keywords that should never appear in generated queries
const DANGEROUS_KEYWORDS = [
  'DELETE', 'UPDATE', 'INSERT', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE'
];

// System prompt template for Claude
const SYSTEM_PROMPT = `You are a data analyst assistant. You help users explore their data by writing SQLite SQL queries.

You have access to the following database schema:

{schema_context}

RULES:
1. Write a single SQLite-compatible SQL query that answers the user's question.
2. Always use double quotes around table and column names to handle spaces and special characters (common in CSV uploads).
3. Use SQLite syntax — it supports common SQL features but NOT window functions with QUALIFY, PIVOT, etc.
4. If the question is ambiguous, make reasonable assumptions and state them.
5. Limit results to 1000 rows maximum (add LIMIT 1000 if no limit specified).
6. For aggregations, always include meaningful column aliases using AS.
7. If the question cannot be answered with the available data, explain why and suggest what data would be needed.
8. Never use DELETE, UPDATE, INSERT, DROP, ALTER, or any DDL/DML. SELECT queries only.
9. For percentage calculations, multiply by 100.0 to get a proper percentage.
10. Use CAST() or printf() for formatting numbers when needed.

Respond in this exact format:

EXPLANATION:
[1-3 sentences explaining your interpretation of the question and approach]

ASSUMPTIONS:
[Any assumptions you made, or "None" if the question was unambiguous]

SQL:
\`\`\`sql
[Your SQLite SQL query here]
\`\`\`

VISUALIZATION:
[Recommend the single best visualization type for this result from: table, bar_chart, line_chart, pie_chart, scatter_plot, area_chart, heatmap, single_number, grouped_bar_chart. Explain in one sentence why this visualization fits.]

VISUALIZATION_TYPE:
[Just the type name from the list above, nothing else — this line is for programmatic parsing]`;

/**
 * Parse Claude's response to extract components
 * @param {string} response - Raw response from Claude
 * @returns {object} Parsed components
 */
function parseResponse(response) {
  const result = {
    explanation: '',
    assumptions: '',
    sql: '',
    visualizationDescription: '',
    visualizationType: 'table',
    raw: response
  };

  try {
    // Extract explanation
    const explanationMatch = response.match(/EXPLANATION:\s*([\s\S]*?)(?=\nASSUMPTIONS:)/i);
    if (explanationMatch) {
      result.explanation = explanationMatch[1].trim();
    }

    // Extract assumptions
    const assumptionsMatch = response.match(/ASSUMPTIONS:\s*([\s\S]*?)(?=\nSQL:)/i);
    if (assumptionsMatch) {
      result.assumptions = assumptionsMatch[1].trim();
    }

    // Extract SQL from code block
    const sqlMatch = response.match(/```sql\s*([\s\S]*?)```/i);
    if (sqlMatch) {
      result.sql = sqlMatch[1].trim();
    }

    // Extract visualization description
    const vizMatch = response.match(/VISUALIZATION:\s*([\s\S]*?)(?=\nVISUALIZATION_TYPE:)/i);
    if (vizMatch) {
      result.visualizationDescription = vizMatch[1].trim();
    }

    // Extract visualization type
    const vizTypeMatch = response.match(/VISUALIZATION_TYPE:\s*(\S+)/i);
    if (vizTypeMatch) {
      result.visualizationType = vizTypeMatch[1].trim().toLowerCase();
    }
  } catch (err) {
    console.error('Error parsing Claude response:', err);
  }

  return result;
}

/**
 * Validate SQL for safety
 * @param {string} sql - SQL query to validate
 * @returns {object} { valid: boolean, error?: string }
 */
function validateSQL(sql) {
  if (!sql || sql.trim().length === 0) {
    return { valid: false, error: 'No SQL query was generated' };
  }

  const upperSQL = sql.toUpperCase();

  // Check for dangerous keywords
  for (const keyword of DANGEROUS_KEYWORDS) {
    // Match keyword as a whole word
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upperSQL)) {
      return { valid: false, error: `Query contains forbidden keyword: ${keyword}` };
    }
  }

  // Check for multiple statements (SQL injection attempt)
  // Allow semicolon only at the end
  const trimmedSQL = sql.trim();
  const semicolonIndex = trimmedSQL.indexOf(';');
  if (semicolonIndex !== -1 && semicolonIndex !== trimmedSQL.length - 1) {
    return { valid: false, error: 'Multiple SQL statements are not allowed' };
  }

  // Must start with SELECT or WITH (for CTEs)
  if (!upperSQL.trimStart().startsWith('SELECT') && !upperSQL.trimStart().startsWith('WITH')) {
    return { valid: false, error: 'Only SELECT queries are allowed' };
  }

  return { valid: true };
}

/**
 * Ask a natural language question about the data
 * @param {object} dataSource - Connected DataSource instance
 * @param {string} question - User's question in natural language
 * @param {object} options - Additional options
 * @returns {Promise<object>} Query result with explanation, SQL, and data
 */
async function askQuestion(dataSource, question, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      error: true,
      errorType: 'configuration_error',
      message: 'Anthropic API key is not configured. Please set ANTHROPIC_API_KEY environment variable.'
    };
  }

  // Gather schema context
  let schemaContext;
  try {
    schemaContext = await dataSource.gatherSchemaContext();
  } catch (err) {
    return {
      error: true,
      errorType: 'schema_error',
      message: `Failed to gather schema context: ${err.message}`
    };
  }

  if (!schemaContext || schemaContext.includes('No tables found')) {
    return {
      error: true,
      errorType: 'no_data',
      message: 'Upload some data first, then come back and ask questions!'
    };
  }

  // Build the prompt
  const systemPrompt = SYSTEM_PROMPT.replace('{schema_context}', schemaContext);

  // Call Claude API
  let claudeResponse;
  try {
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0,
      system: systemPrompt,
      messages: [
        { role: 'user', content: question }
      ]
    });

    claudeResponse = message.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err);
    return {
      error: true,
      errorType: 'api_error',
      message: 'Something went wrong connecting to the AI. Please try again.',
      details: err.message
    };
  }

  // Parse the response
  const parsed = parseResponse(claudeResponse);

  // Validate the SQL
  const validation = validateSQL(parsed.sql);
  if (!validation.valid) {
    return {
      error: true,
      errorType: 'sql_validation_error',
      message: validation.error,
      explanation: parsed.explanation,
      assumptions: parsed.assumptions,
      sql: parsed.sql,
      rawResponse: parsed.raw
    };
  }

  // Execute the SQL with timeout
  let queryResult;
  let queryTime;
  try {
    // Set a timeout using Promise.race
    const timeoutMs = options.timeout || 30000;

    const queryStart = Date.now();
    const queryPromise = dataSource.execute(parsed.sql);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Query timed out')), timeoutMs);
    });

    queryResult = await Promise.race([queryPromise, timeoutPromise]);
    queryTime = Date.now() - queryStart;
  } catch (err) {
    if (err.message === 'Query timed out') {
      return {
        error: true,
        errorType: 'timeout_error',
        message: 'That query took too long. Try asking about a smaller subset of data.',
        explanation: parsed.explanation,
        assumptions: parsed.assumptions,
        sql: parsed.sql,
        rawResponse: parsed.raw
      };
    }

    return {
      error: true,
      errorType: 'sql_execution_error',
      message: `The generated query had an error: ${err.message}. Try rephrasing your question.`,
      explanation: parsed.explanation,
      assumptions: parsed.assumptions,
      sql: parsed.sql,
      rawResponse: parsed.raw
    };
  }

  // Determine column types from results
  const columnTypes = [];
  if (queryResult.rows.length > 0) {
    for (const col of queryResult.columns) {
      const sampleVal = queryResult.rows[0][col];
      if (typeof sampleVal === 'number') {
        columnTypes.push(Number.isInteger(sampleVal) ? 'INTEGER' : 'REAL');
      } else {
        columnTypes.push('TEXT');
      }
    }
  }

  // Check if results were truncated
  const maxRows = 1000;
  const truncated = queryResult.rows.length >= maxRows;

  return {
    error: false,
    explanation: parsed.explanation,
    assumptions: parsed.assumptions,
    sql: parsed.sql,
    visualizationType: parsed.visualizationType,
    visualizationDescription: parsed.visualizationDescription,
    columns: queryResult.columns,
    columnTypes: columnTypes,
    rows: queryResult.rows.slice(0, maxRows),
    rowCount: queryResult.rows.length,
    truncated: truncated,
    queryTime: queryTime,
    rawResponse: parsed.raw
  };
}

module.exports = {
  askQuestion,
  parseResponse,
  validateSQL
};
