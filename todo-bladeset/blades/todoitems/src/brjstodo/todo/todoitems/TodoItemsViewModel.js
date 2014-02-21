"use strict";

var ServiceRegistry = require( 'br/ServiceRegistry' );
var TodoViewModel = require( './TodoViewModel' );
var ko = require( 'ko' );

/**
 * The View Model representing the UI for a list of todo items.
 */
function TodoViewItemsViewModel() {
  this.todos = ko.observableArray();

  this.listVisible = new ko.computed(function() {
        return this.todos().length;
    }, this);

  // count of all completed todos
  this.completedCount = ko.computed(function () {
      return this.todos().filter(function (todo) {
        return todo.completed();
      }).length;
    }.bind(this));

    // count of todos that are not complete
  this.remainingCount = ko.computed(function () {
      return this.todos().length - this.completedCount();
    }.bind(this));

  this.allCompleted = ko.computed({
      //always return true/false based on the done flag of all todos
      read: function () {
        return !this.remainingCount();
      }.bind(this),
      // set all todos to the written value (true/false)
      write: function (newValue) {
        this.todos().forEach(function (todo) {
          // set even if value is the same, as subscribers are not notified in that case
          todo.completed(newValue);
        });
      }.bind(this)
    });

  // get the event hub
  this.eventHub = ServiceRegistry.getService( 'br.event-hub' );

  // register to recieve events
  this.eventHub.channel( 'todo-list' ).on( 'todo-added', this._todoAdded, this );
}

/** @private */
TodoViewItemsViewModel.prototype._todoAdded = function( added ) {
  var todoViewModel = new TodoViewModel( added );
  this.todos.push( todoViewModel );
};

TodoViewItemsViewModel.prototype.remove = function( data, event ) {
  this.todos.remove( data );
};

module.exports = TodoViewItemsViewModel;
