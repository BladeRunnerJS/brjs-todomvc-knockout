var ServiceRegistry = require( 'br/ServiceRegistry' );

var ItemsViewModel = require( 'brjstodo/todo/items/ItemsViewModel' );

var fakeEventHub;
var fakeChannel;

var ItemsViewModelTest = TestCase('ItemsViewModelTest');

var fakeEventHub;
var fakeChannel;

var ExampleClassTest = TestCase('ExampleClassTest');

ItemsViewModelTest.prototype.setUp = function() {

  fakeChannel = {
    on: function(eventName, callback, context) {
      // store event name and data
      this.eventName = eventName;
      this.callback = callback;
      this.context = context;
    }
  };

  fakeEventHub = {
    channel: function( channelName ) {
      // store the name of the channel
      this.channelName = channelName;
      return fakeChannel;
    }
  };

  // ensure there isn't already an event-hub registered
  ServiceRegistry.deregisterService( 'br.event-hub' );

  // Register the fake event hub
  ServiceRegistry.registerService( 'br.event-hub', fakeEventHub );
};

// ItemsViewModelTest.prototype.testTodoItemsBladeListensToItemAddedEvents = function() {
//   var todoItemsBlade = new ItemsViewModel();
//
//   assertEquals( 'todo-list', fakeEventHub.channelName );
//   assertEquals( 'todo-added', fakeChannel.eventName );
//   assertEquals( todoItemsBlade, fakeChannel.context );
// };
//
// ItemsViewModelTest.prototype.testItemsViewModelAddsItemOnTodoAddedEvent = function() {
//   var todoItemsBlade = new ItemsViewModel();
//
//   var itemTitle = 'hello';
//
//   // trigger the callback
//   fakeChannel.callback.call( fakeChannel.context, { title: itemTitle } );
//
//   // check the item has been added to the end of the list
//   var items = todoItemsBlade.todos();
//   assertEquals( itemTitle, items[ items.length - 1 ].title() );
// };
