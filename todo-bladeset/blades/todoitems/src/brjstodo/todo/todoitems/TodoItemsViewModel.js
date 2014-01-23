var br = require( 'br/Core' );
var ServiceRegistry = require( 'br/ServiceRegistry' );
var PresentationModel = require( 'br/presenter/PresentationModel' );
var DisplayField = require( 'br/presenter/node/DisplayField' );
var NodeList = require( 'br/presenter/node/NodeList' );

function TodoViewItemsViewModel() {
  this.items = new NodeList( [] );

  // get the event hub
  this.eventHub = ServiceRegistry.getService( 'br.event-hub' );

  // register to recieve events
  this.eventHub.channel( 'todo-list' ).on( 'todo-added', this._todoAdded, this );
}
br.extend( TodoViewItemsViewModel, PresentationModel );

TodoViewItemsViewModel.prototype._todoAdded = function( added ) {

  // create a new field for the new item
  var newItem = new DisplayField( added.id );
  newItem.label.setValue( added.text );

  // get the existing items
  var nodes = this.items.getPresentationNodesArray();

  // append the new item to the array
  nodes.push( newItem );

  // update the View Model which triggers a UI update
  this.items.updateList( nodes );
};

TodoViewItemsViewModel.prototype.destroyItem = function( data, event ) {
  var nodes = this.items.getPresentationNodesArray();
  var updatedNodes = [];
  nodes.forEach( function( node ) {
    if( node !== data ) {
      updatedNodes.push( node );
    }
  } );

  this.items.updateList( updatedNodes );
};

module.exports = TodoViewItemsViewModel;
