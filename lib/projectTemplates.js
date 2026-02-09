/**
 * Project Templates
 * Pre-configured templates for common use cases
 */

const TEMPLATES = {
  'sales-analytics': {
    id: 'sales-analytics',
    name: 'Sales Analytics',
    icon: '📊',
    description: 'Track revenue, customers, and product performance',
    color: '#5b7cfa',
    defaultDashboardPrompt: 'Create a sales overview dashboard with revenue KPIs, top products by sales, monthly revenue trends, and regional breakdown',
    suggestedQuestions: [
      'What are our total sales and revenue this month?',
      'Which products are our top sellers?',
      'How do sales trends look over the past 6 months?',
      'What is our average order value?',
      'Which customers have the highest lifetime value?',
      'How do sales compare across different regions?',
      'What is our sales conversion rate?',
      'Which sales channels are performing best?'
    ],
    expectedColumns: {
      revenue: ['revenue', 'sales', 'amount', 'total', 'price', 'value'],
      date: ['date', 'order_date', 'sale_date', 'created_at', 'timestamp'],
      customer: ['customer', 'customer_id', 'customer_name', 'client'],
      product: ['product', 'product_id', 'product_name', 'item', 'sku'],
      region: ['region', 'location', 'territory', 'country', 'state'],
      quantity: ['quantity', 'qty', 'units', 'count']
    }
  },

  'inventory-management': {
    id: 'inventory-management',
    name: 'Inventory Management',
    icon: '📦',
    description: 'Monitor stock levels, turnover, and reorder points',
    color: '#34d399',
    defaultDashboardPrompt: 'Create an inventory dashboard showing current stock levels, low stock alerts, inventory turnover rates, and top moving items',
    suggestedQuestions: [
      'What is our current inventory value?',
      'Which items are running low on stock?',
      'What is the inventory turnover rate?',
      'Which products are moving the fastest?',
      'How much dead stock do we have?',
      'What is the average days of inventory on hand?',
      'Which suppliers have the most items in stock?',
      'What are our reorder points by category?'
    ],
    expectedColumns: {
      stock: ['stock', 'quantity', 'on_hand', 'available', 'inventory'],
      product: ['product', 'product_id', 'item', 'sku', 'part_number'],
      cost: ['cost', 'unit_cost', 'price', 'value'],
      supplier: ['supplier', 'vendor', 'manufacturer'],
      category: ['category', 'type', 'class'],
      reorder_point: ['reorder_point', 'min_stock', 'safety_stock']
    }
  },

  'customer-intelligence': {
    id: 'customer-intelligence',
    name: 'Customer Intelligence',
    icon: '👥',
    description: 'Understand segments, lifetime value, and churn risk',
    color: '#c084fc',
    defaultDashboardPrompt: 'Create a customer analysis dashboard with total customers, customer lifetime value, segmentation breakdown, and retention metrics',
    suggestedQuestions: [
      'How many active customers do we have?',
      'What is the average customer lifetime value?',
      'How are customers distributed across segments?',
      'What is our customer retention rate?',
      'Which customers are at risk of churning?',
      'What is the average customer acquisition cost?',
      'Which customer segments are most profitable?',
      'How long is the average customer relationship?'
    ],
    expectedColumns: {
      customer: ['customer', 'customer_id', 'user_id', 'account'],
      value: ['ltv', 'lifetime_value', 'revenue', 'spend'],
      segment: ['segment', 'tier', 'category', 'group'],
      status: ['status', 'active', 'churn_risk', 'health_score'],
      acquisition_date: ['signup_date', 'created_at', 'first_purchase'],
      last_activity: ['last_activity', 'last_purchase', 'last_login']
    }
  },

  'financial-overview': {
    id: 'financial-overview',
    name: 'Financial Overview',
    icon: '💰',
    description: 'P&L tracking, expense analysis, and budget monitoring',
    color: '#f59e0b',
    defaultDashboardPrompt: 'Create a financial dashboard showing revenue vs expenses, profit margins, budget tracking, and cash flow trends',
    suggestedQuestions: [
      'What is our total revenue and profit this quarter?',
      'How do our expenses break down by category?',
      'Are we on track with our budget?',
      'What is our current profit margin?',
      'What is our burn rate?',
      'How do monthly revenues compare year over year?',
      'Which expense categories are growing the fastest?',
      'What is our cash runway?'
    ],
    expectedColumns: {
      revenue: ['revenue', 'income', 'sales'],
      expenses: ['expenses', 'costs', 'spending'],
      category: ['category', 'type', 'account', 'department'],
      date: ['date', 'month', 'period', 'fiscal_period'],
      budget: ['budget', 'forecast', 'planned'],
      actual: ['actual', 'real', 'spent']
    }
  },

  'marketing-performance': {
    id: 'marketing-performance',
    name: 'Marketing Performance',
    icon: '📈',
    description: 'Campaign ROI, funnel analysis, and channel comparison',
    color: '#f472b6',
    defaultDashboardPrompt: 'Create a marketing dashboard with campaign performance, ROI by channel, conversion funnel, and cost per acquisition metrics',
    suggestedQuestions: [
      'What is the ROI of our marketing campaigns?',
      'Which channels have the best conversion rates?',
      'How many leads did we generate this month?',
      'What is our cost per acquisition by channel?',
      'How is our conversion funnel performing?',
      'Which campaigns have the highest engagement?',
      'What is our customer acquisition cost trend?',
      'Which marketing channels drive the most revenue?'
    ],
    expectedColumns: {
      campaign: ['campaign', 'campaign_id', 'campaign_name'],
      channel: ['channel', 'source', 'medium', 'platform'],
      spend: ['spend', 'cost', 'budget', 'investment'],
      conversions: ['conversions', 'leads', 'sales', 'signups'],
      revenue: ['revenue', 'value', 'return'],
      impressions: ['impressions', 'views', 'reach'],
      clicks: ['clicks', 'visits', 'sessions']
    }
  },

  'blank': {
    id: 'blank',
    name: 'Blank Project',
    icon: '🔧',
    description: 'Start from scratch',
    color: '#8888a0',
    defaultDashboardPrompt: null,
    suggestedQuestions: [],
    expectedColumns: {}
  }
};

/**
 * Get all available templates
 */
function getAllTemplates() {
  return Object.values(TEMPLATES);
}

/**
 * Get a specific template by ID
 */
function getTemplateById(templateId) {
  return TEMPLATES[templateId] || null;
}

/**
 * Suggest column mappings for a template based on actual data columns
 */
function suggestColumnMappings(templateId, actualColumns) {
  const template = TEMPLATES[templateId];
  if (!template || !template.expectedColumns) {
    return {};
  }

  const mappings = {};
  const actualColsLower = actualColumns.map(c => c.toLowerCase());

  for (const [expectedKey, variations] of Object.entries(template.expectedColumns)) {
    // Find the first matching column
    for (const variation of variations) {
      const match = actualColsLower.find(col => col.includes(variation));
      if (match) {
        // Find the original case version
        const originalCol = actualColumns[actualColsLower.indexOf(match)];
        mappings[expectedKey] = originalCol;
        break;
      }
    }
  }

  return mappings;
}

module.exports = {
  getAllTemplates,
  getTemplateById,
  suggestColumnMappings,
  TEMPLATES
};
