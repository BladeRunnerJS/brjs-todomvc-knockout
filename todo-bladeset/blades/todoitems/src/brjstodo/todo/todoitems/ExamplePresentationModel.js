var br = require( 'br/Core' );
var ServiceRegistry = require( 'br/ServiceRegistry' );
var PresentationModel = require( 'br/presenter/PresentationModel' );
var DisplayField = require( 'br/presenter/node/DisplayField' );
var NodeList = require( 'br/presenter/node/NodeList' );

function ExamplePresentationModel() {
  this.items = new NodeList( [ new DisplayField( 'foo' ), new DisplayField( 'bar' ) ] );

  // get the event hub
  this.eventHub = ServiceRegistry.getService( 'br.event-hub' );

  // register to recieve events
  this.eventHub.channel( 'todo-list' ).on( 'todo-added', this._todoAdded, this );
}

br.extend( ExamplePresentationModel, PresentationModel );

ExamplePresentationModel.prototype._todoAdded = function( added ) {

  // create a new field for the new item
  var newItem = new DisplayField( added.text );

  // get the existing items
  var nodes = this.items.getPresentationNodesArray();

  // append the new item to the array
  nodes.push( newItem );

  // update the View Model which triggers a UI update
  this.items.updateList( nodes );
};

module.exports = ExamplePresentationModel;