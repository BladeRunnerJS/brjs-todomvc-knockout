"use strict";

var br = require( 'br/Core' );
var ServiceRegistry = require( 'br/ServiceRegistry' );
var PresentationModel = require( 'br/presenter/PresentationModel' );
var DisplayField = require( 'br/presenter/node/DisplayField' );
var WritableProperty = require( 'br/presenter/property/WritableProperty' );
var EditableProperty = require( 'br/presenter/property/EditableProperty' );
var NodeList = require( 'br/presenter/node/NodeList' );
var TodoViewModel = require( './TodoViewModel' );

/**
 * The View Model representing the UI for a list of todo items.
 */
function TodoViewItemsViewModel() {
  this.todos = new NodeList( [] );

  this.listVisible = new WritableProperty();
  this._updateListVisibility();

  this.allCompleted = new EditableProperty();
  this.allCompleted.addChangeListener( this, '_allCompletedChangeListener' );

  // get the event hub
  this.eventHub = ServiceRegistry.getService( 'br.event-hub' );

  // register to recieve events
  this.eventHub.channel( 'todo-list' ).on( 'todo-added', this._todoAdded, this );
}
br.extend( TodoViewItemsViewModel, PresentationModel );

/** @private */
TodoViewItemsViewModel.prototype._todoAdded = function( added ) {

  // create a new field for the new item
  var todoViewModel = new TodoViewModel( added );

  // get the existing items
  var nodes = this.todos.getPresentationNodesArray();

  // append the new item to the array
  nodes.push( todoViewModel );

  // update the View Model which triggers a UI update
  this.todos.updateList( nodes );

  this._updateListVisibility();
};

/** @private */
TodoViewItemsViewModel.prototype._updateListVisibility = function() {
  var visible = ( this.todos.getPresentationNodesArray().length > 0 );
  this.listVisible.setValue( visible );
};

TodoViewItemsViewModel.prototype._allCompletedChangeListener = function() {
  var allCompleted = this.allCompleted.getValue();

  var nodes = this.todos.getPresentationNodesArray();
  nodes.forEach( function( node ) {
    node.completed.setValue( allCompleted );
  } );

  this.todos.updateList( nodes );
};

TodoViewItemsViewModel.prototype.remove = function( data, event ) {
  var nodes = this.todos.getPresentationNodesArray();
  var updatedNodes = [];
  nodes.forEach( function( node ) {
    if( node !== data ) {
      updatedNodes.push( node );
    }
  } );

  this.todos.updateList( updatedNodes );

  this._updateListVisibility();
};

module.exports = TodoViewItemsViewModel;
