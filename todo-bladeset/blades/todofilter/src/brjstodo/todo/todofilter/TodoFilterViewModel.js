"use strict";

var ServiceRegistry = require( 'br/ServiceRegistry' );
var ko = require( 'ko' );

/**
 *
 */
function TodoFilterViewModel() {
  this.todoCount = ko.observable( 0 );
  this.itemsLabel = ko.computed( function() {
    return ( this.todoCount() > 1? 'items' : 'item' );
  }, this );
  this.completedCount = ko.observable( 0 );

  this.visible = new ko.computed(function() {
      return ( this.todoCount() > 0 ||
               this.completedCount() > 0 );
    }, this);

  this._eventHub = ServiceRegistry.getService( 'br.event-hub' );
  this._channel = this._eventHub.channel( 'todo-list' );

  this._channel.on( 'remaining-updated', this._remainingUpdated, this );
  this._channel.on( 'completed-updated', this._completedUpdated, this );
}

/** @private */
TodoFilterViewModel.prototype._remainingUpdated = function( remaining ) {
  this.todoCount( remaining );
};

/** @private */
TodoFilterViewModel.prototype._completedUpdated = function( completed ) {
  this.completedCount( completed );
};

/**
 * Called from the View to indicate completed items should be cleared.
 */
TodoFilterViewModel.prototype.clearCompleted = function() {
  this._channel.trigger( 'clear-completed', null, this );
  return true;
};

module.exports = TodoFilterViewModel;
