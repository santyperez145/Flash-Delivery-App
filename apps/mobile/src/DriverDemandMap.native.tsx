import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polygon, type LatLng, type Region } from "react-native-maps";
import type { DriverDemandZone, GeoPoint } from "./types";

type DriverDemandMapProps = {
  zones: DriverDemandZone[];
  driver?: GeoPoint | null;
  caption: string;
  detail: string;
  height?: number;
  accessibilityLabel?: string;
};

const flashGoogleMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f1eff3" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5f5964" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8f7f9" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#ddd9e1" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9e2e8" }] },
];

const colors: Record<DriverDemandZone["level"], { fill: string; stroke: string; dot: string }> = {
  high: { fill: "rgba(224,56,69,.34)", stroke: "#ce263b", dot: "#ce263b" },
  medium: { fill: "rgba(255,143,43,.29)", stroke: "#e66d13", dot: "#e66d13" },
  low: { fill: "rgba(122,112,128,.16)", stroke: "#857b8b", dot: "#857b8b" },
};

function valid(point: GeoPoint | null | undefined): point is GeoPoint {
  return Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180);
}

function coordinate(point: GeoPoint): LatLng {
  return { latitude: point.lat, longitude: point.lng };
}

function regionFor(points: GeoPoint[]): Region {
  const latitudes=points.map(point=>point.lat),longitudes=points.map(point=>point.lng);
  const minLatitude=Math.min(...latitudes),maxLatitude=Math.max(...latitudes),minLongitude=Math.min(...longitudes),maxLongitude=Math.max(...longitudes);
  return {latitude:(minLatitude+maxLatitude)/2,longitude:(minLongitude+maxLongitude)/2,latitudeDelta:Math.max((maxLatitude-minLatitude)*1.28,.025),longitudeDelta:Math.max((maxLongitude-minLongitude)*1.28,.025)};
}

function center(boundary: GeoPoint[]): GeoPoint {
  const points=boundary.length>1&&boundary[0].lat===boundary.at(-1)?.lat&&boundary[0].lng===boundary.at(-1)?.lng?boundary.slice(0,-1):boundary;
  return {lat:points.reduce((sum,point)=>sum+point.lat,0)/points.length,lng:points.reduce((sum,point)=>sum+point.lng,0)/points.length};
}

export default function DriverDemandMap({zones,driver=null,caption,detail,height=286,accessibilityLabel="Mapa de actividad por zonas"}:DriverDemandMapProps){
  const mapRef=useRef<MapView>(null);
  const [ready,setReady]=useState(false);
  const validZones=useMemo(()=>zones.map(zone=>({...zone,boundary:zone.boundary.filter(valid)})).filter(zone=>zone.boundary.length>=4),[zones]);
  const visiblePoints=useMemo(()=>[...validZones.flatMap(zone=>zone.boundary),...(valid(driver)?[driver]:[])],[driver,validZones]);
  const coordinates=useMemo(()=>visiblePoints.map(coordinate),[visiblePoints]);
  const initialRegion=useMemo(()=>visiblePoints.length?regionFor(visiblePoints):null,[visiblePoints]);
  const fit=useCallback((animated=true)=>{if(!mapRef.current||coordinates.length<2)return;mapRef.current.fitToCoordinates(coordinates,{animated,edgePadding:{top:78,right:22,bottom:58,left:22}});},[coordinates]);
  useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>fit(false),80);return()=>clearTimeout(timer);},[fit,ready]);

  if(!initialRegion)return <View style={[styles.shell,styles.fallback,{height}]} accessibilityLabel={accessibilityLabel}><Ionicons name="map-outline" size={28} color="#7c3cff"/><Text style={styles.fallbackTitle}>Sin zonas cartográficas habilitadas</Text><Text style={styles.fallbackText}>Operaciones debe publicar polígonos PostGIS activos para esta ciudad.</Text></View>;
  if(Platform.OS==="android"&&Constants.expoConfig?.extra?.maps?.androidGoogleMapsConfigured!==true)return <View style={[styles.shell,styles.fallback,{height}]} accessibilityLabel={accessibilityLabel}><Ionicons name="map-outline" size={28} color="#7c3cff"/><Text style={styles.fallbackTitle}>Mapa Android pendiente de configuración</Text><Text style={styles.fallbackText}>Configurá la clave restringida de Google Maps y generá un nuevo build. Los datos zonales siguen disponibles debajo.</Text></View>;

  return <View style={[styles.shell,{height}]} accessibilityLabel={accessibilityLabel}>
    <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={initialRegion} mapType={Platform.OS==="ios"?"mutedStandard":"standard"} customMapStyle={Platform.OS==="android"?flashGoogleMapStyle:undefined} loadingEnabled loadingBackgroundColor="#ece9ef" loadingIndicatorColor="#7c3cff" mapPadding={{top:72,right:12,bottom:48,left:12}} pitchEnabled={false} rotateEnabled={false} showsCompass={false} showsScale={false} showsTraffic={false} showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} moveOnMarkerPress={false} onMapReady={()=>setReady(true)}>
      {validZones.map(zone=><Polygon key={zone.id} coordinates={zone.boundary.map(coordinate)} fillColor={colors[zone.level].fill} strokeColor={colors[zone.level].stroke} strokeWidth={zone.containsDriver?3:2}/>) }
      {validZones.map(zone=><Marker key={`${zone.id}-label`} coordinate={coordinate(center(zone.boundary))} tracksViewChanges={false} anchor={{x:.5,y:.5}}><View style={[styles.zoneLabel,{borderColor:colors[zone.level].stroke}]}><View style={[styles.zoneDot,{backgroundColor:colors[zone.level].dot}]}/><Text style={styles.zoneText} numberOfLines={1}>{zone.name}</Text></View></Marker>)}
      {valid(driver)&&<Marker coordinate={coordinate(driver)} anchor={{x:.5,y:.5}} tracksViewChanges={false}><View style={styles.driverMarker}><Ionicons name="navigate" size={17} color="#fff"/></View></Marker>}
    </MapView>
    <View style={styles.caption} pointerEvents="none"><Text style={styles.captionTitle} numberOfLines={1}>{caption}</Text><Text style={styles.captionDetail} numberOfLines={1}>{detail}</Text></View>
    <View style={styles.legend} pointerEvents="none">{([['high','Alta'],['medium','Media'],['low','Sin pedidos']] as const).map(([level,label])=><View style={styles.legendItem} key={level}><View style={[styles.legendDot,{backgroundColor:colors[level].dot}]}/><Text style={styles.legendText}>{label}</Text></View>)}</View>
    <Pressable style={styles.recenter} onPress={()=>fit(true)} accessibilityRole="button" accessibilityLabel="Reencuadrar zonas"><Ionicons name="scan-outline" size={21} color="#7c3cff"/></Pressable>
  </View>;
}

const styles=StyleSheet.create({
  shell:{position:"relative",overflow:"hidden",borderRadius:24,backgroundColor:"#e9e7ed",borderWidth:1,borderColor:"#ded9e3"},
  caption:{position:"absolute",top:10,left:10,right:54,gap:2,paddingHorizontal:12,paddingVertical:9,borderRadius:14,backgroundColor:"rgba(255,255,255,.95)",shadowColor:"#23192f",shadowOpacity:.14,shadowRadius:12,shadowOffset:{width:0,height:5},elevation:4},
  captionTitle:{color:"#17131c",fontSize:12,fontWeight:"900"},captionDetail:{color:"#716a76",fontSize:10,fontWeight:"700"},
  legend:{position:"absolute",left:10,bottom:10,flexDirection:"row",gap:9,paddingHorizontal:10,paddingVertical:8,borderRadius:12,backgroundColor:"rgba(255,255,255,.94)"},legendItem:{flexDirection:"row",alignItems:"center",gap:4},legendDot:{width:7,height:7,borderRadius:4},legendText:{color:"#5f5964",fontSize:8,fontWeight:"800"},
  recenter:{position:"absolute",right:10,bottom:10,width:40,height:40,alignItems:"center",justifyContent:"center",borderRadius:13,backgroundColor:"#fff",shadowColor:"#23192f",shadowOpacity:.18,shadowRadius:10,shadowOffset:{width:0,height:4},elevation:5},
  zoneLabel:{maxWidth:105,minHeight:27,flexDirection:"row",alignItems:"center",gap:5,paddingHorizontal:8,borderRadius:10,borderWidth:1.5,backgroundColor:"rgba(255,255,255,.94)"},zoneDot:{width:7,height:7,borderRadius:4},zoneText:{flexShrink:1,color:"#27212b",fontSize:9,fontWeight:"900"},
  driverMarker:{width:38,height:38,borderRadius:19,alignItems:"center",justifyContent:"center",backgroundColor:"#17131c",borderWidth:3,borderColor:"#fff",shadowColor:"#111",shadowOpacity:.24,shadowRadius:9,elevation:6},
  fallback:{alignItems:"center",justifyContent:"center",gap:7,padding:24},fallbackTitle:{color:"#17131c",fontSize:13,fontWeight:"900",textAlign:"center"},fallbackText:{color:"#716a76",fontSize:11,fontWeight:"600",lineHeight:16,textAlign:"center"},
});
