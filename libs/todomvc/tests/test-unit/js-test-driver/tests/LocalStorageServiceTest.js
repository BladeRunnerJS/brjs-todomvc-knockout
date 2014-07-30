var LocalStorageServiceTest = TestCase( 'LocalStorageServiceTest' );

var LocalStorageService = require( 'todomvc/LocalStorageService' );

LocalStorageServiceTest.prototype.testTodoAddedEventIsTriggeredWhenAddingItem = function() {
	var service = new LocalStorageService();

	var triggered = false;
	service.on( 'todo-added', function() {
		triggered = true;
	} );

	var item = { title: 'some text' };
	service.addTodo( item );

	assertTrue( triggered );
};
