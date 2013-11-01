caplin.thirdparty( 'caplin-br' );

( function() {

  var ENTER_KEY_CODE = 13;

  var br = require( 'br' );
  var ServiceRegistry = require( 'br/ServiceRegistry' );
  
  function ExamplePresentationModel() {
    this.todoText = new br.presenter.node.Field( '' );
    this.eventHub = ServiceRegistry.getService( 'br.demo-event-hub' );
  };
  br.extend( ExamplePresentationModel, br.presenter.PresentationModel );
  
  ExamplePresentationModel.prototype.keyPressed = function( data, event ) {
    if( event.keyCode === ENTER_KEY_CODE ) {
      var todoTextValue = this.todoText.value.getValue();
      this.eventHub.channel( 'todo-list' ).trigger( 'todo-added', { text: todoTextValue } );
      this.todoText.value.setValue( '' );
    }

    return true;
  };
  
  brjstodo.todo.todoinput.ExamplePresentationModel = ExamplePresentationModel;

} )();