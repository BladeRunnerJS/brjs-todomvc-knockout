"use strict";

var ServiceRegistry = require( 'br/ServiceRegistry' );
var ko = require( 'ko' );

/**
 *
 */
function FilterViewModel() {
  this._todoService = ServiceRegistry.getService( 'todomvc.storage' );
  this._todoService.on( 'todo-added', this._sync, this );
  this._todoService.on( 'todo-updated', this._sync, this );
  this._todoService.on( 'todo-removed', this._sync, this );

  var todos = this._todoService.getTodos();

  this.todoCount = ko.observable( todos.length );
  this.itemsLabel = ko.computed( function() {
    return ( this.todoCount() > 1? 'items' : 'item' );
  }, this );
  this.completedCount = ko.observable( 0 );

  this.visible = new ko.computed(function() {
      return ( this.todoCount() > 0 ||
               this.completedCount() > 0 );
    }, this);
}

/**
 * Synchronise the UI state with the contents of the service.
 */
FilterViewModel.prototype._sync = function() {
  var todos = this._todoService.getTodos();
  this.todoCount( todos.length );

  var completed = 0;
  todos.forEach( function( todo ) {
    if( todo.completed ) {
      ++completed;
    }
  }, this );
  this.completedCount( completed );
};

/**
 * Called from the View to indicate completed items should be cleared.
 */
FilterViewModel.prototype.clearCompleted = function() {
  var todos = this._todoService.getTodos();
  var toRemove = [];
  todos.forEach( function( todo ) {
    if( todo.completed ) {
      toRemove.push( todo );
    }
  }, this );

  toRemove.forEach( function( todo ) {
    this._todoService.removeTodo( todo );
  }, this );
};

module.exports = FilterViewModel;
