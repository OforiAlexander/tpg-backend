exports.up = async function(knex) {
    const hasMetadata = await knex.schema.hasColumn('ticket_comments', 'metadata');
    const hasCreatedAt = await knex.schema.hasColumn('ticket_comments', 'created_at');
    const hasUpdatedAt = await knex.schema.hasColumn('ticket_comments', 'updated_at');
  
    return knex.schema.alterTable('ticket_comments', function(table) {
      if (!hasMetadata) {
        table.jsonb('metadata').defaultTo('{}');
      }
      if (!hasCreatedAt) {
        table.timestamp('created_at').defaultTo(knex.fn.now());
      }
      if (!hasUpdatedAt) {
        table.timestamp('updated_at').defaultTo(knex.fn.now());
      }
    });
  };
  
  
  exports.down = function(knex) {
    return knex.schema.alterTable('ticket_comments', function(table) {
      table.dropColumn('metadata');
      table.dropColumn('updated_at');
    });
  };