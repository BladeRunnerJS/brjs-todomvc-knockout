var KnockoutComponent = require( 'br/knockout/KnockoutComponent' );
var SimpleFrame = require('br/component/SimpleFrame');
var InputViewModel = require( 'brjstodo/input/InputViewModel' );
var ItemsViewModel = require( 'brjstodo/items/ItemsViewModel' );
var FilterViewModel = require( 'brjstodo/filter/FilterViewModel' );

var ServiceRegistry = require( 'br/ServiceRegistry' );
var LocalStorageService = require( 'todomvc/LocalStorageService' );
var todoService = new LocalStorageService();
ServiceRegistry.registerService( 'todomvc.storage', todoService );

var App = function() {

  var todoAppEl = document.getElementById( 'todoapp' );

  // todo input Blade
  var inputModel = new InputViewModel();
  var inputComponent = new KnockoutComponent( 'brjstodo.input.view-template', inputModel );
  var inputFrame = new SimpleFrame(inputComponent, null, null);
  todoAppEl.appendChild( inputFrame.getElement() );
  inputFrame.trigger('attach');

  // todo items Blade
  var itemsModel = new ItemsViewModel();
  var itemsComponent = new KnockoutComponent( 'brjstodo.items.view-template', itemsModel );
  var itemsFrame = new SimpleFrame(itemsComponent, null, null);
  todoAppEl.appendChild( itemsFrame.getElement() );
  itemsFrame.trigger('attach');

  // todo filter/footer
  var filterModel = new FilterViewModel();
  var filterComponent = new KnockoutComponent( 'brjstodo.filter.view-template', filterModel );
  var filterFrame = new SimpleFrame(filterComponent, null, null);
  todoAppEl.appendChild( filterFrame.getElement() );
  filterFrame.trigger('attach');

};

module.exports = App;
