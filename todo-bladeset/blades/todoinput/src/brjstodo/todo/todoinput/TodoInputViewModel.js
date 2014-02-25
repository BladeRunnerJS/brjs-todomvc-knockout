"use strict";

var ENTER_KEY_CODE = 13;

var ServiceRegistry = require( 'br/ServiceRegistry' );
var ko = require( 'ko' );

function TodoInputViewModel() {
  this.todoText = ko.observable('');
  this.eventHub = ServiceRegistry.getService( 'br.event-hub' );
}

TodoInputViewModel.prototype.keyPressed = function( data, event ) {
  if( event.keyCode === ENTER_KEY_CODE ) {
    var todoTextValue = this.todoText();
    this.eventHub.channel( 'todo-list' ).trigger( 'todo-added', { title: todoTextValue } );
    this.todoText( '' );
  }

  return true;
};

module.exports = TodoInputViewModel;