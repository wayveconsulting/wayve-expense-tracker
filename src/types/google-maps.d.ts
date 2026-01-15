// Extend Google Maps types for beta PlaceAutocompleteElement
declare namespace google.maps.places {
  class PlaceAutocompleteElement extends HTMLElement {
    constructor(options?: PlaceAutocompleteElementOptions)
    style: CSSStyleDeclaration
  }

  interface PlaceAutocompleteElementOptions {
    componentRestrictions?: ComponentRestrictions
    fields?: string[]
    types?: string[]
  }
}

declare namespace google.maps {
  interface PlacesLibrary {
    PlaceAutocompleteElement: typeof google.maps.places.PlaceAutocompleteElement
  }
  
  interface RoutesLibrary {
    DistanceMatrixService: typeof google.maps.DistanceMatrixService
  }
}