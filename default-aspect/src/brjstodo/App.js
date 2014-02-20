var PresenterComponent = require( 'br/presenter/component/PresenterComponent' );
var TodoInputViewModel = require( 'brjstodo/todo/todoinput/TodoInputViewModel' );
var TodoItemsViewModel = require( 'brjstodo/todo/todoitems/TodoItemsViewModel' );

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
  var inputComponent = new PresenterComponent( 'brjstodo.todo.todoinput.view-template', inputModel );
  var inputEl = inputComponent.getElement().children[ 0 ];
  todoAppEl.appendChild( inputEl );

  // todo items Blade
  var itemsModel = new TodoItemsViewModel();
  var itemsComponent = new PresenterComponent( 'brjstodo.todo.todoitems.view-template', itemsModel );
  var itemsEl = itemsComponent.getElement().children[ 0 ];
  todoAppEl.appendChild( itemsEl );

  // TODO: footer
};

module.exports = App;
