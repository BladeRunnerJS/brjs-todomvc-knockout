var KnockoutComponent = require( 'br/knockout/KnockoutComponent' );
var TodoInputViewModel = require( 'brjstodo/todo/todoinput/TodoInputViewModel' );
var TodoItemsViewModel = require( 'brjstodo/todo/todoitems/TodoItemsViewModel' );
var TodoFilterViewModel = require( 'brjstodo/todo/todofilter/TodoFilterViewModel' );

var App = function() {

  var todoAppEl = document.getElementById( 'todoapp' );

  // todo input Blade
  var inputModel = new TodoInputViewModel();
  var inputComponent = new KnockoutComponent( 'brjstodo.todo.todoinput.view-template', inputModel );
  var inputEl = inputComponent.getElement();
  todoAppEl.appendChild( inputEl );

  // todo items Blade
  var itemsModel = new TodoItemsViewModel();
  var itemsComponent = new KnockoutComponent( 'brjstodo.todo.todoitems.view-template', itemsModel );
  var itemsEl = itemsComponent.getElement();
  todoAppEl.appendChild( itemsEl );

  // todo filter/footer
  var filterModel = new TodoFilterViewModel();
  var filterComponent = new KnockoutComponent( 'brjstodo.todo.todofilter.view-template', filterModel );
  var filterEl = filterComponent.getElement();
  todoAppEl.appendChild( filterEl );
};

module.exports = App;
