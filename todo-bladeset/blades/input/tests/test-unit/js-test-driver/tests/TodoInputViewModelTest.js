var ServiceRegistry = require( 'br/ServiceRegistry' );
var InputViewModel = require( 'brjstodo/todo/input/InputViewModel' );
var TodoService = require( 'todomvc/TodoService' );

var InputViewModelTest = TestCase('InputViewModelTest');

InputViewModelTest.prototype.setUp = function() {

  ServiceRegistry.deregisterService( 'todomvc.storage' );
  ServiceRegistry.registerService( 'todomvc.storage', {} );
};

InputViewModelTest.prototype.testTodoTextFieldIsInitialized = function() {
  var todoInputBlade = new InputViewModel();

  assertEquals( '', todoInputBlade.todoText() );
};

// InputViewModelTest.prototype.testEnterKeyPressedTriggersEventOnEventHub = function() {
//   // Initialize
//   var testTodoTitle = 'write some code and test it';
//   var todoInputBlade = new InputViewModel();
//   todoInputBlade.todoText( testTodoTitle );
//
//   // Execute test
//   todoInputBlade.keyPressed( null, { keyCode: 13 } );
//
//   // Verify
//   assertEquals( 'todo-list', fakeEventHub.channelName );
//   assertEquals( 'todo-added', fakeChannel.eventName );
//   assertEquals( testTodoTitle, fakeChannel.data.title );
// };
