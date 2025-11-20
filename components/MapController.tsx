import React, { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { Coordinates } from '../types';

interface MapControllerProps {
  selectedCoordinates: Coordinates | null;
}

export const MapController: React.FC<MapControllerProps> = ({ selectedCoordinates }) => {
  const map = useMap();

  useEffect(() => {
    if (selectedCoordinates) {
      map.flyTo([selectedCoordinates.lat, selectedCoordinates.lng], 15, {
        duration: 2, // Animation duration in seconds
      });
    }
  }, [selectedCoordinates, map]);

  return null;
};
