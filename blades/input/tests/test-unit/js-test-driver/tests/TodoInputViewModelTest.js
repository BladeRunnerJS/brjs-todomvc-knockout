var ServiceRegistry = require( 'br/ServiceRegistry' );
var InputViewModel = require( 'brjstodo/input/InputViewModel' );
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
