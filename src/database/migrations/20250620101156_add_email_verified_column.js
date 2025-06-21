exports.up = function(knex) {
    return knex.schema.alterTable('users', table => {
      table.boolean('email_verified').defaultTo(false).notNullable();
      table.index(['email_verified']);
    })
    .then(() => {
      return knex('users')
        .update({ email_verified: true })
        .whereNotNull('email_verified_at');
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.alterTable('users', table => {
      table.dropIndex(['email_verified']);
      table.dropColumn('email_verified');
    });
  };