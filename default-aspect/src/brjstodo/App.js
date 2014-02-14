var PresenterComponent = require( 'br/presenter/component/PresenterComponent' );
var TodoInputViewModel = require( 'brjstodo/todo/todoinput/TodoInputViewModel' );
var TodoItemsViewModel = require( 'brjstodo/todo/todoitems/TodoItemsViewModel' );

var App = function() {

  // todo input Blade
  var inputModel = new TodoInputViewModel();
  var inputComponent = new PresenterComponent( 'brjstodo.todo.todoinput.view-template', inputModel );
  document.getElementById( 'header' ).appendChild( inputComponent.getElement() );

  // todo items Blade
  var itemsModel = new TodoItemsViewModel();        
  var itemsComponent = new PresenterComponent( 'brjstodo.todo.todoitems.view-template', itemsModel );
  document.getElementById( 'main' ).appendChild( itemsComponent.getElement() );
};

module.exports = App;
