var br = require( 'br/Core' );
var Emitr = require( 'emitr' );
var TodoService = require( './TodoService' );

var TODO_ITEMS_ID = 'brjs-todo-items';

function LocalStorageService() {
  var items = localStorage.getItem( TODO_ITEMS_ID );
  this._items = ( items ? JSON.parse( items ) : [] );
}
br.extend( LocalStorageService, Emitr );
br.implement( LocalStorageService, TodoService );

LocalStorageService.prototype.addTodo = function( item ) {
  this._items.push( item );
  this._sync();
  this.trigger( 'todo-added', item );
};

LocalStorageService.prototype.updateTodo = function( item ) {
  this._items.forEach( function( existingItem, index ) {
    if ( item === existingItem ) {
      // since check is by reference there's no need for the following line
      // this._items[ i ] = item;
      this._sync();

      this.trigger( 'todo-updated', item );

      return false;
    }
  }, this );
};

LocalStorageService.prototype.removeTodo = function( item ) {
  this._items.forEach( function( existingItem, index ) {
    if ( item === existingItem ) {
      this._items.splice( item, 1 );
      this._sync();

      this.trigger( 'todo-removed', item );

      return false;
    }
  }, this );
};

LocalStorageService.prototype.getTodos = function() {
  return this._items;
};

LocalStorageService.prototype._sync = function() {
  localStorage.setItem( TODO_ITEMS_ID, JSON.stringify( this._items ) );
};

module.exports = LocalStorageService;
