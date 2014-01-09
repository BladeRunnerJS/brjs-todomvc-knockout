var ENTER_KEY_CODE = 13;

var br = require( 'br/Core' );
var ServiceRegistry = require( 'br/ServiceRegistry' );
var PresentationModel = require( 'br/presenter/PresentationModel' );
var Field = require( 'br/presenter/node/Field' );

function ExamplePresentationModel() {
  this.todoText = new Field( '' );
  this.eventHub = ServiceRegistry.getService( 'br.demo-event-hub' );
}
br.extend( ExamplePresentationModel, PresentationModel );

ExamplePresentationModel.prototype.keyPressed = function( data, event ) {
  if( event.keyCode === ENTER_KEY_CODE ) {
    var todoTextValue = this.todoText.value.getValue();
    this.eventHub.channel( 'todo-list' ).trigger( 'todo-added', { text: todoTextValue } );
    this.todoText.value.setValue( '' );
  }

  return true;
};

module.exports = ExamplePresentationModel;