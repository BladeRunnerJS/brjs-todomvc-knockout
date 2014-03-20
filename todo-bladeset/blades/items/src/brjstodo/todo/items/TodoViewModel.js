"use strict";

var ko = require( 'ko' );
var ServiceRegistry = require( 'br/ServiceRegistry' );

function TodoViewModel( todo ) {
  this._todo = todo;
  this._todoService = ServiceRegistry.getService( 'todomvc.storage' );

  this.title = ko.observable( todo.title );
  this.completed = ko.observable( todo.completed || false );

  this.editing = ko.observable( false );
  // Used to store old title during editing
  this.previousTitle = null;

  this.title.subscribe( function( updatedVal ) {
    this._todo.title = updatedVal;
    this._todoService.updateTodo( this._todo );
  }, this );

  this.completed.subscribe( function( updatedVal ) {
    this._todo.completed = updatedVal;
    this._todoService.updateTodo( this._todo );
  }, this );
}

TodoViewModel.prototype.getTodo = function() {
  return this._todo;
};

module.exports = TodoViewModel;
