var ServiceRegistry = require( 'br/ServiceRegistry' );

var TodoItemsViewModel = require( 'brjstodo/todo/todoinput/TodoItemsViewModel' );

var fakeEventHub;
var fakeChannel;
    
var TodoItemsViewModelTest = TestCase('TodoItemsViewModelTest');

TodoItemsViewModelTest.prototype.setUp = function() {

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

TodoItemsViewModelTest.prototype.testTodoItemsBladeListensToItemAddedEvents = function() {
  var todoItemsBlade = new TodoItemsViewModel();

  assertEquals( fakeEventHub.channelName , 'todo-list' );
  assertEquals( fakeChannel.eventName , 'todo-added' );
  assertEquals( fakeChannel.context , todoItemsBlade );
};

TodoItemsViewModelTest.prototype.testItemsViewModelAddsItemOnTodoAddedEvent = function() {
  var todoItemsBlade = new TodoItemsViewModel();

  var itemText = 'hello';

  // trigger the callback
  fakeChannel.callback.call( fakeChannel.context, { text: itemText } );

  // check the item has been added to the end of the list
  var items = todoItemsBlade.items.getPresentationNodesArray();
  assertEquals( itemText, items[ items.length - 1 ].value.getValue() );
};