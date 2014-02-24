"use strict";

var ServiceRegistry = require( 'br/ServiceRegistry' );
var TodoViewModel = require( './TodoViewModel' );
var ko = require( 'ko' );

/**
 * The View Model representing the UI for a list of todo items.
 */
function TodoViewItemsViewModel() {
  // get the event hub
  this._eventHub = ServiceRegistry.getService( 'br.event-hub' );

  // register to recieve events
  this._channel = this._eventHub.channel( 'todo-list' );
  this._channel.on( 'todo-added', this._todoAdded, this );
  this._channel.on( 'clear-completed', this._clearCompleted, this );

  this.todos = ko.observableArray();

  this.listVisible = new ko.computed(function() {
        return this.todos().length;
    }, this);

  // count of all completed todos
  this.completedCount = ko.computed(function () {
      var count = this.todos().filter(function (todo) {
        return todo.completed();
      }).length;

      this._channel.trigger( 'completed-updated', count );

      return count;
    }, this );

  // count of todos that are not complete
  this.remainingCount = ko.computed(function () {
      var remaining = ( this.todos().length - this.completedCount() );
      this._channel.trigger( 'remaining-updated', remaining );
      
      return remaining;
    }, this );

  this.allCompleted = ko.computed({
      //always return true/false based on the done flag of all todos
      read: function () {
        return !this.remainingCount();
      },
      // set all todos to the written value (true/false)
      write: function (newValue) {
        this.todos().forEach(function (todo) {
          // set even if value is the same, as subscribers are not notified in that case
          todo.completed(newValue);
        });
      }
    }, this);
}

/** @private */
TodoViewItemsViewModel.prototype._todoAdded = function( added ) {
  var todoViewModel = new TodoViewModel( added );
  this.todos.push( todoViewModel );
};

/** @private */
TodoViewItemsViewModel.prototype._clearCompleted = function() {
  this.todos.remove( function( todo ) {
    return todo.completed();
  } );
};

/**
 * Called from the view to remove a todo item.
 */
TodoViewItemsViewModel.prototype.remove = function( data, event ) {
  this.todos.remove( data );
};

module.exports = TodoViewItemsViewModel;
