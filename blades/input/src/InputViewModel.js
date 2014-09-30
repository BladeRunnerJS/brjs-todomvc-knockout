"use strict";

var ENTER_KEY_CODE = 13;

var ServiceRegistry = require( 'br/ServiceRegistry' );
var ko = require( 'ko' );

function InputViewModel() {
  this.todoText = ko.observable('');
  this._todoService = ServiceRegistry.getService( 'todomvc.storage' );
}

InputViewModel.prototype.keyPressed = function( data, event ) {
  if( event.keyCode === ENTER_KEY_CODE ) {
    var todoTextValue = this.todoText().trim();

    var todoItem = { title: todoTextValue };
    this._todoService.addTodo( todoItem );

    this.todoText( '' );
  }

  return true;
};

module.exports = InputViewModel;
