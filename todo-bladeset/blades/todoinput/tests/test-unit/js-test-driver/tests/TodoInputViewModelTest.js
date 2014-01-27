var ServiceRegistry = require( 'br/ServiceRegistry' );

var TodoInputViewModel = require( 'brjstodo/todo/todoinput/TodoInputViewModel' );

var fakeEventHub;
var fakeChannel;
    
var TodoInputViewModelTest = TestCase('TodoInputViewModelTest');

TodoInputViewModelTest.prototype.setUp = function() {

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

TodoInputViewModelTest.prototype.testTodoItemsBladeListensToItemAddedEvents = function() {
  var todoItemsBlade = new TodoInputViewModel();

  assertEquals( fakeEventHub.channelName , 'todo-list' );
  assertEquals( fakeChannel.eventName , 'todo-added' );
  assertEquals( fakeChannel.context , todoItemsBlade );
};

TodoInputViewModelTest.prototype.testItemsViewModelAddsItemOnTodoAddedEvent = function() {
  var todoItemsBlade = new TodoInputViewModel();

  var itemTitle = 'hello';

  // trigger the callback
  fakeChannel.callback.call( fakeChannel.context, { title: itemTitle } );

  // check the item has been added to the end of the list
  var items = todoItemsBlade.items.getPresentationNodesArray();
  assertEquals( itemTitle, items[ items.length - 1 ].value.getValue() );
};