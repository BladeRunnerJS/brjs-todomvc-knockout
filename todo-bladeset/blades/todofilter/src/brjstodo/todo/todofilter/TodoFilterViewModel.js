var br = require( 'br/Core' );
var ServiceRegistry = require( 'br/ServiceRegistry' );
var PresentationModel = require( 'br/presenter/PresentationModel' );
var WritableProperty = require( 'br/presenter/property/WritableProperty' );

function TodoFilterViewModel() {
  this.todoCount = new WritableProperty( 0 );

  this.eventHub = ServiceRegistry.getService( 'br.event-hub' );
}
br.extend( TodoFilterViewModel, PresentationModel );

TodoFilterViewModel.prototype.clearCompleted = function() {
  return true;
};

module.exports = TodoFilterViewModel;