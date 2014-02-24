var KnockoutComponent = require( 'br/knockout/KnockoutComponent' );
var TodoInputViewModel = require( 'brjstodo/todo/todoinput/TodoInputViewModel' );
var TodoItemsViewModel = require( 'brjstodo/todo/todoitems/TodoItemsViewModel' );
var TodoFilterViewModel = require( 'brjstodo/todo/todofilter/TodoFilterViewModel' );

var App = function() {

  var todoAppEl = document.getElementById( 'todoapp' );

  /*
  Note:
  Templates are retrieved from the HTMLService using an element ID. Since TodoMVC
  requires parts of the HTML to have uniqueID and those IDs are for what we could
  consider the Blades of the TodoMVC app we have to wrap the Blade templates
  in a parent element. Hence, the calls to component.getElement().children[0].
  */

  // todo input Blade
  var inputModel = new TodoInputViewModel();
  var inputComponent = new KnockoutComponent( 'brjstodo.todo.todoinput.view-template', inputModel );
  var inputEl = inputComponent.getElement().children[ 0 ];
  todoAppEl.appendChild( inputEl );

  // todo items Blade
  var itemsModel = new TodoItemsViewModel();
  var itemsComponent = new KnockoutComponent( 'brjstodo.todo.todoitems.view-template', itemsModel );
  var itemsEl = itemsComponent.getElement().children[ 0 ];
  todoAppEl.appendChild( itemsEl );

  // todo filter/footer
  var filterModel = new TodoFilterViewModel();
  var filterComponent = new KnockoutComponent( 'brjstodo.todo.todofilter.view-template', filterModel );
  var filterEl = filterComponent.getElement().children[ 0 ];
  todoAppEl.appendChild( filterEl );
};

module.exports = App;
