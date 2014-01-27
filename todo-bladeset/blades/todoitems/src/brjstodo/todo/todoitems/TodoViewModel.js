"use strict";

var br = require( 'br/Core' );
var PresentationNode = require( 'br/presenter/node/PresentationNode' );
var WritableProperty = require( 'br/presenter/property/WritableProperty' );

function TodoViewModel( todo ) {
  this._todo = todo;

  this.title = new WritableProperty( todo.title );
  this.completed = new WritableProperty( todo.completed || false );
  this.editing = new WritableProperty( false );
}
br.extend( TodoViewModel, PresentationNode );

TodoViewModel.prototype.getTodo = function() {
  return this._todo;
};

module.exports = TodoViewModel;