var KnockoutComponent = require( 'br/knockout/KnockoutComponent' );
var InputViewModel = require( 'brjstodo/todo/input/InputViewModel' );
var ItemsViewModel = require( 'brjstodo/todo/items/ItemsViewModel' );
var FilterViewModel = require( 'brjstodo/todo/filter/FilterViewModel' );

var ServiceRegistry = require( 'br/ServiceRegistry' );
var LocalStorageService = require( 'todomvc/LocalStorageService' );
var todoService = new LocalStorageService();
ServiceRegistry.registerService( 'todomvc.storage', todoService );

var App = function() {

  var todoAppEl = document.getElementById( 'todoapp' );

  // todo input Blade
  // var inputModel = new InputViewModel();
  // var inputComponent = new KnockoutComponent( 'brjstodo.todo.input.view-template', inputModel );
  // var inputEl = inputComponent.getElement();
  // todoAppEl.appendChild( inputEl );

  var angular = require( 'angular' );
  var InputDirective = require( 'brjstodo/ng/input/InputDirective' );
  angular.module('brjstodo', [] )
    .directive('todoInput', function() {
      return new InputDirective();
    } );

  // todo items Blade
  var itemsModel = new ItemsViewModel();
  var itemsComponent = new KnockoutComponent( 'brjstodo.todo.items.view-template', itemsModel );
  var itemsEl = itemsComponent.getElement();
  todoAppEl.appendChild( itemsEl );

  // todo filter/footer
  var filterModel = new FilterViewModel();
  var filterComponent = new KnockoutComponent( 'brjstodo.todo.filter.view-template', filterModel );
  var filterEl = filterComponent.getElement();
  todoAppEl.appendChild( filterEl );
};

module.exports = App;
