"use strict";

var ko = require( 'ko' );

function TodoViewModel( todo ) {
  this._todo = todo;

  this.title = ko.observable( todo.title );
  this.completed = ko.observable( todo.completed || false );
  this.editing = ko.observable( false );
  // Used to store old title during editing
  this.previousTitle = null;
}

module.exports = TodoViewModel;