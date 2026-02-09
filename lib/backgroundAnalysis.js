/**
 * Background Analysis Module
 *
 * Runs autonomous AI-powered exploratory analysis of a project's data,
 * generating questions, executing queries, and finding insights.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { askQuestion } = require('./nlquery');
const { generateInsights } = require('./insights');
const { trackApiUsage, getCurrentUsage, calculateCost } = require('./api-usage');

// Minimum credits required to start a background analysis
const MIN_CREDITS_REQUIRED = 0.50;

// Delay between queries to avoid rate limiting (ms)
const QUERY_DELAY_MS = 2000;

/**
 * System prompt for generating analysis plan
 */
const ANALYSIS_PLAN_PROMPT = `You are a senior data analyst beginning an exploratory analysis of a business database. Your goal is to find hidden insights, anomalies, cost-saving opportunities, and patterns the business owner hasn't thought to look for.

SCHEMA:
{schema_context}

Generate exactly 10 analytical questions to explore, ordered from most likely to reveal valuable insights to least. Focus on:
1. Money leaks: overspending, pricing anomalies, unprofitable segments
2. Concentration risks: over-reliance on one customer/product/region
3. Trend breaks: sudden changes that deserve investigation
4. Pareto analysis: are 20% of X causing 80% of Y?
5. Missing data patterns: columns with lots of nulls might indicate process issues
6. Cross-table relationships: correlations between different datasets
7. Seasonality and time patterns
8. Outlier detection: values far from the mean

Respond as JSON:
[
  {
    "question": "The natural language question",
    "rationale": "Why this might reveal something valuable",
    "estimated_complexity": "simple|moderate|complex"
  }
]

Return ONLY valid JSON, no explanation text.`;

/**
 * System prompt for generating executive summary
 */
const SUMMARY_PROMPT = `You just completed an exploratory analysis of a business database. Here are the insights discovered:

{insights_json}

Write a 3-5 sentence executive summary of the most important findings. Prioritize actionable items. Start with the most critical finding. Be specific with numbers.`;

// Store running jobs in memory (for cancellation)
const runningJobs = new Map();

/**
 * Generate an analysis plan of questions to explore
 * @param {string} schemaContext - Schema context from the data source
 * @returns {Promise<object>} { questions: Array, usage: object }
 */
async function generateAnalysisPlan(schemaContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  const prompt = ANALYSIS_PLAN_PROMPT.replace('{schema_context}', schemaContext);

  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    temperature: 0.3,
    messages: [
      { role: 'user', content: prompt }
    ]
  });

  const responseText = message.content[0].text;

  // Parse the JSON response
  let questions = [];
  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      questions = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error('Failed to parse analysis plan:', err);
    throw new Error('Failed to generate analysis plan');
  }

  return {
    questions,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens
    }
  };
}

/**
 * Generate executive summary from insights
 * @param {Array} insights - Array of insight objects
 * @returns {Promise<object>} { summary: string, usage: object }
 */
async function generateExecutiveSummary(insights) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { summary: 'Analysis complete. Review individual findings for details.', usage: null };
  }

  if (!insights || insights.length === 0) {
    return { summary: 'No significant insights were discovered in this analysis.', usage: null };
  }

  const prompt = SUMMARY_PROMPT.replace('{insights_json}', JSON.stringify(insights, null, 2));

  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0.3,
    messages: [
      { role: 'user', content: prompt }
    ]
  });

  return {
    summary: message.content[0].text.trim(),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens
    }
  };
}

/**
 * Sleep helper
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a job has been cancelled
 * @param {string} jobId - Job ID
 * @returns {boolean} True if cancelled
 */
function isJobCancelled(jobId) {
  const job = runningJobs.get(jobId);
  return job && job.cancelled;
}

/**
 * Start a background analysis job
 * @param {object} options - Options
 * @param {object} options.db - Database instance
 * @param {string} options.tenantId - Tenant ID
 * @param {string} options.projectId - Project ID
 * @param {number} options.creditsBudget - Max credits to spend
 * @param {object} options.dataSource - Connected DataSource instance
 * @param {string} options.schemaContext - Schema context
 * @returns {Promise<string>} Job ID
 */
async function startBackgroundAnalysis({ db, tenantId, projectId, creditsBudget = 2.00, dataSource, schemaContext }) {
  // Check remaining credits for this month
  const usage = getCurrentUsage(db, tenantId);
  const creditsAllocated = usage?.credits_allocated || 10.00; // Default allocation
  const creditsUsed = usage?.credits_used || 0;
  const creditsRemaining = creditsAllocated - creditsUsed;

  if (creditsRemaining < MIN_CREDITS_REQUIRED) {
    throw new Error(`Not enough credits remaining this month. You have $${creditsRemaining.toFixed(2)} left.`);
  }

  // Cap the budget at remaining credits
  const effectiveBudget = Math.min(creditsBudget, creditsRemaining);

  // Create the job record
  const jobId = uuidv4();
  db.prepare(`
    INSERT INTO background_jobs (id, tenant_id, project_id, status, credits_budget)
    VALUES (?, ?, ?, 'queued', ?)
  `).run(jobId, tenantId, projectId, effectiveBudget);

  // Mark job as running in memory
  runningJobs.set(jobId, { cancelled: false });

  // Start the analysis asynchronously
  setImmediate(async () => {
    await runAnalysis(db, jobId, tenantId, projectId, effectiveBudget, dataSource, schemaContext);
  });

  return jobId;
}

/**
 * Run the background analysis
 * @param {object} db - Database instance
 * @param {string} jobId - Job ID
 * @param {string} tenantId - Tenant ID
 * @param {string} projectId - Project ID
 * @param {number} creditsBudget - Max credits to spend
 * @param {object} dataSource - Connected DataSource instance
 * @param {string} schemaContext - Schema context
 */
async function runAnalysis(db, jobId, tenantId, projectId, creditsBudget, dataSource, schemaContext) {
  let totalCreditsUsed = 0;
  const allInsights = [];
  const findings = [];

  try {
    // Update status to running
    db.prepare(`
      UPDATE background_jobs
      SET status = 'running', started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(jobId);

    // Check for cancellation
    if (isJobCancelled(jobId)) {
      db.prepare(`UPDATE background_jobs SET status = 'failed', error_message = 'Cancelled by user' WHERE id = ?`).run(jobId);
      runningJobs.delete(jobId);
      return;
    }

    // Step 1: Generate analysis plan
    console.log(`[BackgroundAnalysis ${jobId}] Generating analysis plan...`);
    const planResult = await generateAnalysisPlan(schemaContext);

    // Track usage for plan generation
    if (planResult.usage) {
      const planCost = calculateCost(planResult.usage.inputTokens, planResult.usage.outputTokens);
      totalCreditsUsed += planCost;
      trackApiUsage(db, tenantId, planResult.usage.inputTokens, planResult.usage.outputTokens, 'background_analysis');
    }

    const questions = planResult.questions || [];
    console.log(`[BackgroundAnalysis ${jobId}] Generated ${questions.length} questions`);

    // Update job with planned questions
    db.prepare(`
      UPDATE background_jobs
      SET total_questions_planned = ?, credits_used = ?
      WHERE id = ?
    `).run(questions.length, totalCreditsUsed, jobId);

    // Step 2: Execute each question sequentially
    for (let i = 0; i < questions.length; i++) {
      // Check for cancellation
      if (isJobCancelled(jobId)) {
        db.prepare(`UPDATE background_jobs SET status = 'failed', error_message = 'Cancelled by user', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);
        runningJobs.delete(jobId);
        return;
      }

      // Check budget
      if (totalCreditsUsed >= creditsBudget) {
        console.log(`[BackgroundAnalysis ${jobId}] Budget exhausted, pausing job`);
        db.prepare(`
          UPDATE background_jobs
          SET status = 'paused_credits',
              credits_used = ?,
              findings = ?,
              completed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(totalCreditsUsed, JSON.stringify(findings), jobId);
        runningJobs.delete(jobId);
        return;
      }

      const question = questions[i];
      console.log(`[BackgroundAnalysis ${jobId}] Executing question ${i + 1}/${questions.length}: ${question.question}`);

      try {
        // Execute the question
        const queryResult = await askQuestion(dataSource, question.question, { timeout: 30000 });

        // Estimate and track query cost (rough estimate: ~500 input, ~300 output tokens)
        const queryCost = calculateCost(500, 300);
        totalCreditsUsed += queryCost;
        trackApiUsage(db, tenantId, 500, 300, 'background_analysis');

        if (!queryResult.error && queryResult.rows && queryResult.rows.length > 0) {
          // Save the query to the database
          const queryId = uuidv4();
          const resultSummary = {
            rowCount: queryResult.rows?.length || 0,
            columnNames: queryResult.columns || [],
            sampleRows: queryResult.rows?.slice(0, 5) || []
          };

          db.prepare(`
            INSERT INTO queries
            (id, project_id, tenant_id, question, sql_generated, explanation, assumptions,
             visualization_type, visualization_config, result_summary, execution_time_ms, status, source, background_job_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', 'background', ?)
          `).run(
            queryId,
            projectId,
            tenantId,
            question.question,
            queryResult.sql || null,
            queryResult.explanation || null,
            queryResult.assumptions || null,
            queryResult.visualizationType || null,
            queryResult.chartConfig ? JSON.stringify(queryResult.chartConfig) : null,
            JSON.stringify(resultSummary),
            queryResult.queryTime || 0,
            jobId
          );

          // Generate insights for this query
          const insightResult = await generateInsights({
            question: question.question,
            sql: queryResult.sql,
            columns: queryResult.columns || [],
            rows: queryResult.rows || [],
            schemaContext
          });

          // Track insight generation cost
          if (insightResult.usage) {
            const insightCost = calculateCost(insightResult.usage.inputTokens, insightResult.usage.outputTokens);
            totalCreditsUsed += insightCost;
            trackApiUsage(db, tenantId, insightResult.usage.inputTokens, insightResult.usage.outputTokens, 'background_analysis');
          }

          // Save insights to database
          if (insightResult.insights && insightResult.insights.length > 0) {
            const insertInsight = db.prepare(`
              INSERT INTO insights
              (id, project_id, tenant_id, query_id, insight_type, title, description, severity, data_evidence, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'background_analysis')
            `);

            for (const insight of insightResult.insights) {
              const insightId = uuidv4();
              insertInsight.run(
                insightId,
                projectId,
                tenantId,
                queryId,
                insight.type,
                insight.title,
                insight.description,
                insight.severity,
                JSON.stringify(insight.evidence)
              );

              allInsights.push({
                ...insight,
                id: insightId,
                queryId
              });
            }
          }

          // Add to findings
          findings.push({
            questionIndex: i,
            question: question.question,
            rationale: question.rationale,
            queryId,
            visualizationType: queryResult.visualizationType,
            rowCount: queryResult.rows?.length || 0,
            insightCount: insightResult.insights?.length || 0,
            status: 'success'
          });

        } else {
          // Query failed or returned no results
          findings.push({
            questionIndex: i,
            question: question.question,
            rationale: question.rationale,
            status: 'no_results',
            error: queryResult.error ? queryResult.message : 'No results returned'
          });
        }

      } catch (err) {
        console.error(`[BackgroundAnalysis ${jobId}] Error on question ${i + 1}:`, err);
        findings.push({
          questionIndex: i,
          question: question.question,
          rationale: question.rationale,
          status: 'error',
          error: err.message
        });
      }

      // Update progress
      db.prepare(`
        UPDATE background_jobs
        SET questions_completed = ?, credits_used = ?, findings = ?
        WHERE id = ?
      `).run(i + 1, totalCreditsUsed, JSON.stringify(findings), jobId);

      // Wait before next query
      if (i < questions.length - 1) {
        await sleep(QUERY_DELAY_MS);
      }
    }

    // Step 3: Generate executive summary
    console.log(`[BackgroundAnalysis ${jobId}] Generating executive summary...`);
    const summaryResult = await generateExecutiveSummary(allInsights);

    if (summaryResult.usage) {
      const summaryCost = calculateCost(summaryResult.usage.inputTokens, summaryResult.usage.outputTokens);
      totalCreditsUsed += summaryCost;
      trackApiUsage(db, tenantId, summaryResult.usage.inputTokens, summaryResult.usage.outputTokens, 'background_analysis');
    }

    // Mark job as completed
    db.prepare(`
      UPDATE background_jobs
      SET status = 'completed',
          credits_used = ?,
          findings = ?,
          executive_summary = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalCreditsUsed, JSON.stringify(findings), summaryResult.summary, jobId);

    console.log(`[BackgroundAnalysis ${jobId}] Completed successfully. Used $${totalCreditsUsed.toFixed(4)} in credits.`);

  } catch (err) {
    console.error(`[BackgroundAnalysis ${jobId}] Failed:`, err);
    db.prepare(`
      UPDATE background_jobs
      SET status = 'failed',
          error_message = ?,
          credits_used = ?,
          findings = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(err.message, totalCreditsUsed, JSON.stringify(findings), jobId);
  }

  // Clean up
  runningJobs.delete(jobId);
}

/**
 * Cancel a running background analysis job
 * @param {string} jobId - Job ID
 * @returns {boolean} True if job was running and marked for cancellation
 */
function cancelJob(jobId) {
  const job = runningJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    return true;
  }
  return false;
}

/**
 * Get job status
 * @param {object} db - Database instance
 * @param {string} jobId - Job ID
 * @param {string} tenantId - Tenant ID (for isolation)
 * @returns {object|null} Job record or null
 */
function getJob(db, jobId, tenantId) {
  const job = db.prepare(`
    SELECT * FROM background_jobs
    WHERE id = ? AND tenant_id = ?
  `).get(jobId, tenantId);

  if (job) {
    job.findings = job.findings ? JSON.parse(job.findings) : [];
  }

  return job;
}

/**
 * Get jobs for a project
 * @param {object} db - Database instance
 * @param {string} projectId - Project ID
 * @param {string} tenantId - Tenant ID (for isolation)
 * @returns {Array} Array of job records
 */
function getJobsForProject(db, projectId, tenantId) {
  const jobs = db.prepare(`
    SELECT * FROM background_jobs
    WHERE project_id = ? AND tenant_id = ?
    ORDER BY created_at DESC
  `).all(projectId, tenantId);

  return jobs.map(job => ({
    ...job,
    findings: job.findings ? JSON.parse(job.findings) : []
  }));
}

/**
 * Get all active jobs for a tenant (for sidebar display)
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @returns {Array} Array of active job records
 */
function getActiveJobs(db, tenantId) {
  const jobs = db.prepare(`
    SELECT bj.*, p.name as project_name
    FROM background_jobs bj
    JOIN projects p ON bj.project_id = p.id
    WHERE bj.tenant_id = ? AND bj.status IN ('queued', 'running')
    ORDER BY bj.created_at DESC
  `).all(tenantId);

  return jobs.map(job => ({
    ...job,
    findings: job.findings ? JSON.parse(job.findings) : []
  }));
}

/**
 * Get recent completed jobs for a tenant (for sidebar display)
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @param {number} limit - Max jobs to return
 * @returns {Array} Array of completed job records
 */
function getRecentCompletedJobs(db, tenantId, limit = 5) {
  const jobs = db.prepare(`
    SELECT bj.*, p.name as project_name,
           (SELECT COUNT(*) FROM insights WHERE insights.source = 'background_analysis'
            AND insights.query_id IN (SELECT id FROM queries WHERE background_job_id = bj.id)) as insight_count
    FROM background_jobs bj
    JOIN projects p ON bj.project_id = p.id
    WHERE bj.tenant_id = ? AND bj.status IN ('completed', 'paused_credits')
    ORDER BY bj.completed_at DESC
    LIMIT ?
  `).all(tenantId, limit);

  return jobs.map(job => ({
    ...job,
    findings: job.findings ? JSON.parse(job.findings) : []
  }));
}

/**
 * Get queries generated by a background job
 * @param {object} db - Database instance
 * @param {string} jobId - Job ID
 * @param {string} tenantId - Tenant ID
 * @returns {Array} Array of query records
 */
function getJobQueries(db, jobId, tenantId) {
  const queries = db.prepare(`
    SELECT q.*,
           (SELECT COUNT(*) FROM insights WHERE insights.query_id = q.id) as insight_count
    FROM queries q
    WHERE q.background_job_id = ? AND q.tenant_id = ?
    ORDER BY q.created_at ASC
  `).all(jobId, tenantId);

  return queries.map(q => ({
    ...q,
    result_summary: q.result_summary ? JSON.parse(q.result_summary) : null,
    visualization_config: q.visualization_config ? JSON.parse(q.visualization_config) : null
  }));
}

module.exports = {
  startBackgroundAnalysis,
  cancelJob,
  getJob,
  getJobsForProject,
  getActiveJobs,
  getRecentCompletedJobs,
  getJobQueries,
  MIN_CREDITS_REQUIRED
};
