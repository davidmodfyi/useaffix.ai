const { v4: uuidv4 } = require('uuid');

/**
 * Relationship Detector
 * Auto-detects potential foreign key relationships between tables in a project
 */

class RelationshipDetector {
  constructor(db, dataSourceInstance) {
    this.db = db;
    this.dataSource = dataSourceInstance;
  }

  /**
   * Detect relationships across all tables in a project's data source
   * @param {string} projectId - Project ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Array of detected relationships
   */
  async detectRelationships(projectId, tenantId) {
    if (!this.dataSource || !this.dataSource.isConnected()) {
      throw new Error('Data source not connected');
    }

    const tables = await this.dataSource.getTables();
    const relationships = [];

    // Get column metadata for all tables
    const tableSchemas = {};
    for (const table of tables) {
      tableSchemas[table] = await this.dataSource.getColumns(table);
    }

    // Compare every table pair
    for (let i = 0; i < tables.length; i++) {
      for (let j = 0; j < tables.length; j++) {
        if (i === j) continue; // Skip same table

        const sourceTable = tables[i];
        const targetTable = tables[j];
        const sourceColumns = tableSchemas[sourceTable];
        const targetColumns = tableSchemas[targetTable];

        // Check for potential foreign key relationships
        for (const sourceCol of sourceColumns) {
          for (const targetCol of targetColumns) {
            const relationship = this._evaluateColumnPair(
              sourceTable,
              sourceCol,
              targetTable,
              targetCol
            );

            if (relationship) {
              relationships.push({
                ...relationship,
                projectId,
                tenantId,
              });
            }
          }
        }
      }
    }

    return relationships;
  }

  /**
   * Evaluate if two columns form a potential foreign key relationship
   * @private
   */
  _evaluateColumnPair(sourceTable, sourceCol, targetTable, targetCol) {
    let confidence = 0;
    const reasons = [];

    // Pattern 1: Exact name match (e.g., customer_id in both tables)
    if (sourceCol.name.toLowerCase() === targetCol.name.toLowerCase()) {
      confidence += 0.6;
      reasons.push('exact_name_match');
    }

    // Pattern 2: Source column references target table name
    // e.g., orders.customer_id → customers.id
    const sourceColLower = sourceCol.name.toLowerCase();
    const targetTableSingular = this._singularize(targetTable.toLowerCase());

    if (
      (sourceColLower === `${targetTableSingular}_id` && targetCol.name.toLowerCase() === 'id') ||
      (sourceColLower === `${targetTable.toLowerCase()}_id` && targetCol.name.toLowerCase() === 'id')
    ) {
      confidence += 0.9;
      reasons.push('naming_convention_fk');
    }

    // Pattern 3: Source column ends with _id and matches target table
    if (sourceColLower.endsWith('_id') && targetCol.name.toLowerCase() === 'id') {
      const prefix = sourceColLower.replace(/_id$/, '');
      if (targetTable.toLowerCase().includes(prefix) || prefix.includes(targetTable.toLowerCase())) {
        confidence += 0.7;
        reasons.push('partial_table_name_match');
      }
    }

    // Pattern 4: Same base name, one has _id suffix
    const sourceBase = sourceColLower.replace(/_id$/, '');
    const targetBase = targetCol.name.toLowerCase().replace(/_id$/, '');
    if (sourceBase === targetBase && sourceColLower.endsWith('_id')) {
      confidence += 0.5;
      reasons.push('base_name_match');
    }

    // Only return relationships with confidence > 0.4
    if (confidence > 0.4) {
      return {
        source_table: sourceTable,
        source_column: sourceCol.name,
        target_table: targetTable,
        target_column: targetCol.name,
        confidence: Math.min(confidence, 1.0),
        reasons: reasons.join(','),
      };
    }

    return null;
  }

  /**
   * Simple singularization (works for common cases)
   * @private
   */
  _singularize(word) {
    if (word.endsWith('ies')) {
      return word.slice(0, -3) + 'y'; // companies → company
    }
    if (word.endsWith('es')) {
      return word.slice(0, -2); // classes → class
    }
    if (word.endsWith('s')) {
      return word.slice(0, -1); // users → user
    }
    return word;
  }

  /**
   * Save detected relationships to database
   */
  async saveRelationships(relationships) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO data_relationships (
        id, project_id, tenant_id, source_table, source_column,
        target_table, target_column, confidence, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suggested')
    `);

    const insertMany = this.db.transaction((rels) => {
      for (const rel of rels) {
        insert.run(
          uuidv4(),
          rel.projectId,
          rel.tenantId,
          rel.source_table,
          rel.source_column,
          rel.target_table,
          rel.target_column,
          rel.confidence
        );
      }
    });

    insertMany(relationships);
  }

  /**
   * Get all relationships for a project
   */
  getProjectRelationships(projectId) {
    return this.db
      .prepare(
        `SELECT * FROM data_relationships
         WHERE project_id = ?
         ORDER BY confidence DESC, created_at DESC`
      )
      .all(projectId);
  }

  /**
   * Update relationship status (confirmed or rejected)
   */
  updateRelationshipStatus(relationshipId, status) {
    return this.db
      .prepare(
        `UPDATE data_relationships
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(status, relationshipId);
  }

  /**
   * Delete a relationship
   */
  deleteRelationship(relationshipId) {
    return this.db.prepare(`DELETE FROM data_relationships WHERE id = ?`).run(relationshipId);
  }

  /**
   * Get confirmed relationships as schema context for AI queries
   */
  getConfirmedRelationshipsContext(projectId) {
    const relationships = this.db
      .prepare(
        `SELECT * FROM data_relationships
         WHERE project_id = ? AND (status = 'confirmed' OR confidence > 0.8)
         ORDER BY confidence DESC`
      )
      .all(projectId);

    if (relationships.length === 0) {
      return '';
    }

    let context = '\nCONFIRMED RELATIONSHIPS:\n';
    for (const rel of relationships) {
      context += `- ${rel.source_table}.${rel.source_column} → ${rel.target_table}.${rel.target_column}\n`;
    }

    return context;
  }
}

module.exports = RelationshipDetector;
