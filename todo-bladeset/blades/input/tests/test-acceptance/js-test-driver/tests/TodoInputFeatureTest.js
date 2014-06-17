'use strict';

var ServiceRegistry = require( 'br/ServiceRegistry' );
var InputViewModel = require( 'brjstodo/todo/input/InputViewModel' );

require( 'jasmine' );

describe('The Input', function() {

  it( 'Should add new todo items to the TodoService', function() {
    // Setup
    var todoService = jasmine.createSpyObj( 'todos', [ 'addTodo' ] );
    ServiceRegistry.registerService( 'todomvc.storage', todoService );

    var testTodoTitle = 'write some code and test it';
    var todoInputBlade = new InputViewModel();
    todoInputBlade.todoText( testTodoTitle );

    var expectedEventData = {
      title: testTodoTitle
    };

    // Execute test
    todoInputBlade.keyPressed( null, { keyCode: 13 } );

    // Assert
    expect( todoService.addTodo ).toHaveBeenCalledWith( expectedEventData );
  } );

});
