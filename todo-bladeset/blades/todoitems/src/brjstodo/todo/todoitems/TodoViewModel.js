"use strict";

var ko = require( 'ko' );

function TodoViewModel( todo ) {
  this._todo = todo;

  this.title = ko.observable( todo.title );
  this.completed = ko.observable( todo.completed || false );
  this.editing = ko.observable( false );
}

module.exports = TodoViewModel;