var PresenterComponent = require( 'br/presenter/component/PresenterComponent' );
var SimpleFrame = require( 'br/component/SimpleFrame' );

var App = function() {

  // todo input Blade
  var inputModel = new brjstodo.todo.todoinput.ExamplePresentationModel();
  this.inputComponent = new PresenterComponent( 'brjstodo.todo.todoinput.view-template', inputModel );

  // todo items Blade
  var itemsModel = new brjstodo.todo.todoitems.ExamplePresentationModel();        
  this.itemsComponent = new PresenterComponent( 'brjstodo.todo.todoitems.view-template', itemsModel );

  var inputFrame = new SimpleFrame( this.inputComponent );
  document.getElementById( 'header' ).appendChild( inputFrame.getElement() );

  var itemsFrame = new SimpleFrame( this.itemsComponent );
  document.getElementById( 'main' ).appendChild( itemsFrame.getElement() );
};

module.exports = App;
