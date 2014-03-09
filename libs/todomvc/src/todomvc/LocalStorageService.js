var br = require( 'br/Core' );
var TodosService = require( './TodosService' );

function LocalStorageService() {
}
br.implements( LocalStorageService, TodosService );


module.exports = LocalStorageService;
