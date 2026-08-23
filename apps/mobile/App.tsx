import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { captureRef } from "react-native-view-shot";
import Svg, { Path } from "react-native-svg";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { api } from "./src/api";
import { configureAnalytics, track } from "./src/analytics";
import FlashNativeMap from "./src/FlashNativeMap";
import DriverDemandMap from "./src/DriverDemandMap";
import { flashDesign } from "./src/design-system";
import { buildExternalNavigationUrl } from "./src/navigation-links";
import {getBackgroundLocationState,startDriverBackgroundLocation,stopDriverBackgroundLocation,type BackgroundLocationState} from "./src/background-location";
import type {
  AppState,
  DispatchOffer,
  Driver,
  DriverCompliance,
  DriverDemand,
  DriverDocument,
  DriverEarnings,
  DriverPreferences,
  DriverVehicle,
  FoodCheckoutQuote,
  GeoPoint,
  MerchantOperationsDashboard,
  Mode,
  Order,
  OrderSubstitution,
  AppNotification,
  NotificationPreference,
  DietaryPreferences,
  Restaurant,
  Ride,
  RideDestination,
  RideTrustedContact,
  RideQuote,
  RideService,
  ServiceReceipt,
  ServiceMessage,
  Shipment,
  ShipmentQuote,
  ShipmentOptions,
  ShipmentReturn,
  ShipmentClaim,
  User,
} from "./src/types";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const mobileOrderStatusLabel:Record<Order["status"],string>={requested:"Validando pago",accepted:"Nuevo · aceptar",preparing:"En preparación",ready_for_pickup:"Listo para retirar",courier_assigned:"Courier asignado",picked_up:"Retirado",delivering:"En camino",delivered:"Entregado",cancelled:"Cancelado"};

function operationalDuration(seconds: number | null | undefined) {
  if (seconds == null) return "No disponible";
  const safeSeconds=Math.max(0,seconds);
  if(safeSeconds===0)return "0 min";
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function compactMoney(value: number) {
  const sign=value<0?"-":"";
  const absolute=Math.abs(value);
  if(absolute>=1_000_000)return `${sign}$${(absolute/1_000_000).toFixed(absolute>=10_000_000?0:1).replace(".0","")}M`;
  if(absolute>=1_000)return `${sign}$${(absolute/1_000).toFixed(absolute>=10_000?0:1).replace(".0","")}k`;
  return `${sign}$${Math.round(absolute)}`;
}

type RoadStep = {
  type: string;
  modifier: string;
  street: string;
  distanceM: number;
  durationSec: number;
  location: GeoPoint;
};
type RoadRoute = {
  distanceKm: number;
  durationMin: number;
  coordinates: GeoPoint[];
  steps: RoadStep[];
};
type DriverNavigationTarget = {
  id: string;
  kind: "Viaje" | "Comida" | "Envío";
  phase: string;
  point: GeoPoint | null | undefined;
  address: string;
};

function NativeMapUnavailable({message,height=260}:{message:string;height?:number}){
  return <View style={[styles.trackingMap,styles.nativeMapEmpty,{height}]}><Ionicons name="map-outline" size={30} color="#7c3cff"/><Text style={styles.nativeMapEmptyTitle}>Mapa pendiente de coordenadas</Text><Text style={styles.nativeMapEmptyText}>{message}</Text></View>;
}

function navigationInstruction(step: RoadStep) {
  const action =
    step.type === "arrive"
      ? "Llegá a destino"
      : step.modifier.includes("left")
        ? "Girá a la izquierda"
        : step.modifier.includes("right")
          ? "Girá a la derecha"
          : step.type === "depart"
            ? "Empezá"
            : "Continuá";
  return `${action} por ${step.street}`;
}

function DriverNavigationModal({visible,target,origin,route,routeError,vehicleIcon,onExternal,onChat,onClose}:{visible:boolean;target:DriverNavigationTarget|null;origin:GeoPoint|null;route:RoadRoute|null;routeError:string;vehicleIcon:"bicycle"|"car-sport";onExternal:()=>void;onChat:()=>void;onClose:()=>void}){
  const{height}=useWindowDimensions(),mapHeight=Math.max(250,Math.min(420,height*.48)),step=route?.steps[0]||null,routeColor=target?.kind==="Comida"?"#ff6a21":target?.kind==="Envío"?"#087a50":"#7c3cff",turnIcon=step?.modifier.includes("left")?"arrow-back":step?.modifier.includes("right")?"arrow-forward":"arrow-up";
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><SafeAreaView style={styles.driverNavScreen}><View style={styles.driverNavTop}><Pressable style={styles.driverNavClose} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar guía"><Ionicons name="chevron-down" size={24} color="#fff"/></Pressable><View style={styles.driverNavTurn}><Ionicons name={turnIcon} size={30} color="#15121a"/></View><View style={styles.itemCopy}><Text style={styles.driverNavPhase}>{target?.kind.toUpperCase()} · {target?.phase.toUpperCase()}</Text><Text style={styles.driverNavInstruction}>{step?navigationInstruction(step):routeError||"Calculando la mejor ruta disponible…"}</Text>{step?<Text style={styles.driverNavDistance}>en {Math.max(10,Math.round(step.distanceM))} m</Text>:null}</View></View>{origin&&target?.point?<FlashNativeMap origin={origin} destination={target.point} route={route?.coordinates||[]} originRole="driver" driverIcon={vehicleIcon} routeColor={routeColor} caption={target.phase} detail={route?`${route.distanceKm} km · ${route.durationMin} min restantes`:routeError||"Actualizando recorrido vial…"} height={mapHeight} accessibilityLabel="Mapa de la guía operativa del conductor"/>:<NativeMapUnavailable height={mapHeight} message={origin?"El próximo punto todavía no tiene coordenadas verificadas.":"Activá el GPS para iniciar la guía."}/>}<ScrollView style={styles.driverNavSheet} contentContainerStyle={styles.driverNavSheetContent} showsVerticalScrollIndicator={false}><View style={styles.driverNavEtaRow}><View><Text style={styles.driverNavEta}>{route?`${route.durationMin} min`:"--"}</Text><Text style={styles.helperText}>{route?`${route.distanceKm} km restantes`:"Esperando ruta"}</Text></View><View style={[styles.driverNavKind,{backgroundColor:routeColor}]}><Ionicons name={target?.kind==="Comida"?"restaurant":target?.kind==="Envío"?"cube":"car-sport"} size={21} color="#fff"/></View></View><Text style={styles.driverNavDestinationLabel}>PRÓXIMO PUNTO</Text><Text style={styles.driverNavDestination}>{target?.address}</Text>{route?.steps.slice(0,3).map((item,index)=><View style={styles.driverNavStep} key={`${item.type}-${item.location.lat}-${item.location.lng}-${index}`}><View style={[styles.driverNavStepIndex,index===0&&{backgroundColor:routeColor}]}><Text style={styles.driverNavStepIndexText}>{index+1}</Text></View><View style={styles.itemCopy}><Text style={styles.driverNavStepText}>{navigationInstruction(item)}</Text><Text style={styles.helperText}>{Math.max(10,Math.round(item.distanceM))} m</Text></View></View>)}<View style={styles.driverNavActions}><Pressable style={styles.driverNavSecondary} onPress={onChat}><Ionicons name="chatbubble-ellipses-outline" size={20} color="#17131c"/><Text style={styles.driverNavSecondaryText}>Chat</Text></Pressable><Pressable style={styles.driverNavPrimary} disabled={!target?.point} onPress={onExternal}><Ionicons name="navigate" size={20} color="#fff"/><Text style={styles.primaryButtonText}>Abrir guía giro a giro</Text></Pressable></View><Text style={styles.driverNavDisclaimer}>Flash mantiene etapa, destino y recorrido. Google Maps o Apple Maps aporta la navegación completa mientras tráfico y voz propios no estén habilitados.</Text></ScrollView></SafeAreaView></Modal>;
}

function OrderTrackingSheet({order,driver,onClose}:{order:Order|null;driver:Driver|null;onClose:()=>void}){
  const[route,setRoute]=useState<RoadRoute|null>(null),[routeError,setRouteError]=useState("");
  useEffect(()=>{if(!order?.pickupLocation||!order.deliveryLocation){setRoute(null);return;}let cancelled=false;setRouteError("");void api.route(order.pickupLocation,order.deliveryLocation).then(result=>{if(!cancelled)setRoute(result.route);}).catch(()=>{if(!cancelled)setRouteError("No pudimos cargar la ruta; el estado del pedido sigue actualizado.");});return()=>{cancelled=true;};},[order?.id,order?.pickupLocation?.lat,order?.pickupLocation?.lng,order?.deliveryLocation?.lat,order?.deliveryLocation?.lng]);
  const hasMap=Boolean(order?.pickupLocation&&order.deliveryLocation);
  if(!order)return null;const stages=["accepted","preparing","ready_for_pickup","courier_assigned","picked_up","delivering","delivered"],current=Math.max(0,stages.indexOf(order.status)),labels=["Confirmado","Preparando","Listo","Repartidor asignado","Retirado","En camino","Entregado"];
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.trackingBackdrop}><View style={styles.trackingSheet}><View style={styles.trackingHeader}><View><Text style={styles.orderConfirmationEyebrow}>SEGUIMIENTO EN VIVO</Text><Text style={styles.foodRestaurantTitle}>Pedido {order.id}</Text></View><Pressable style={styles.foodBack} onPress={onClose}><Ionicons name="close" size={21} color="#222"/></Pressable></View>{hasMap?<FlashNativeMap origin={order.pickupLocation!} destination={order.deliveryLocation!} route={route?.coordinates||[]} driver={driver?.location||null} routeColor="#ff6a21" driverIcon="bicycle" caption={route?`${route.distanceKm} km · ${route.durationMin} min de recorrido`:routeError||"Calculando ruta…"} detail={driver?`${driver.name} · ${driver.vehicle}`:"Buscando repartidor disponible"} accessibilityLabel="Mapa interactivo del pedido"/>:<NativeMapUnavailable message={routeError||"El comercio o la entrega todavía no tienen coordenadas verificadas."}/>}<View style={styles.trackingStatus}><Text style={styles.foodRestaurantTitle}>{labels[current]}</Text><Text style={styles.cardText}>{order.status==="delivered"?"Tu pedido fue entregado.":`ETA publicada: ${order.etaMin} min`}</Text><View style={styles.trackingProgress}>{labels.map((label,index)=><View style={styles.trackingStage} key={label}><View style={[styles.trackingStageDot,index<=current&&styles.trackingStageDotActive]}>{index<current?<Ionicons name="checkmark" size={11} color="#fff"/>:null}</View><Text style={[styles.trackingStageText,index===current&&styles.trackingStageTextActive]}>{label}</Text></View>)}</View></View><Pressable style={styles.orderConfirmationAction} onPress={()=>Share.share({title:"Pedido Flash",message:`Mi pedido ${order.id} está ${labels[current].toLowerCase()}.`})}><Ionicons name="share-social-outline" size={18} color="#fff"/><Text style={styles.orderConfirmationActionText}>Compartir estado</Text></Pressable></View></View></Modal>;
}

function RideTrackingSheet({ride,driver,contacts,pickupCode,onRevealCode,onShare,onSos,onCancel,onClose}:{ride:Ride|null;driver:Driver|null;contacts:RideTrustedContact[];pickupCode:string|null;onRevealCode:()=>Promise<void>;onShare:(contact?:RideTrustedContact)=>void;onSos:()=>void;onCancel:()=>void;onClose:()=>void}){
  const[route,setRoute]=useState<RoadRoute|null>(null),[routeError,setRouteError]=useState("");
  useEffect(()=>{if(!ride?.pickupLocation||!ride.destinationLocation){setRoute(null);return;}let cancelled=false;setRouteError("");void api.route(ride.pickupLocation,ride.destinationLocation).then(result=>{if(!cancelled)setRoute(result.route);}).catch(()=>{if(!cancelled)setRouteError("La ruta no está disponible; el estado del viaje sigue actualizado.");});return()=>{cancelled=true;};},[ride?.id,ride?.pickupLocation?.lat,ride?.pickupLocation?.lng,ride?.destinationLocation?.lat,ride?.destinationLocation?.lng]);
  const hasMap=Boolean(ride?.pickupLocation&&ride.destinationLocation);
  if(!ride)return null;
  const stages:Ride["status"][]=["requested","driver_assigned","arriving","in_progress","completed"],labels=["Buscando conductor","Conductor asignado","Llegando a buscarte","Viaje en curso","Llegaste"],current=Math.max(0,stages.indexOf(ride.status)),headline=labels[current]||ride.status.replaceAll("_"," ");
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.trackingBackdrop}><View style={styles.trackingSheet}><View style={styles.trackingHeader}><View><Text style={styles.orderConfirmationEyebrow}>VIAJE EN VIVO</Text><Text style={styles.foodRestaurantTitle}>{headline}</Text></View><Pressable style={styles.foodBack} onPress={onClose}><Ionicons name="close" size={21} color="#222"/></Pressable></View>{hasMap?<FlashNativeMap origin={ride.pickupLocation!} destination={ride.destinationLocation!} route={route?.coordinates||[]} driver={driver?.location||null} routeColor="#7c3cff" caption={route?`${route.distanceKm} km · ${route.durationMin} min`:routeError||"Calculando ruta real…"} detail={driver?`${driver.name} · ${driver.vehicle}`:"Buscando un conductor disponible"} accessibilityLabel="Mapa interactivo del viaje"/>:<NativeMapUnavailable message={routeError||"El origen o el destino todavía no tienen coordenadas verificadas."}/>}<ScrollView showsVerticalScrollIndicator={false}><View style={styles.trackingStatus}><Text style={styles.foodRestaurantTitle}>{headline}</Text><Text style={styles.cardText}>{ride.pickup} → {ride.destination}</Text><View style={styles.trackingProgress}>{labels.map((label,index)=><View style={styles.trackingStage} key={label}><View style={[styles.trackingStageDot,index<=current&&styles.trackingStageDotActive]}>{index<current?<Ionicons name="checkmark" size={11} color="#fff"/>:null}</View><Text style={[styles.trackingStageText,index===current&&styles.trackingStageTextActive]}>{label}</Text></View>)}</View></View>{driver?<View style={styles.shipmentTrackingSummary}><View><Text style={styles.orderConfirmationEyebrow}>TU CONDUCTOR</Text><Text style={styles.sectionTitle}>{driver.name}</Text><Text style={styles.cardText}>{driver.vehicle} · ★ {driver.rating.toFixed(1)}</Text></View><View style={styles.shipmentTrackingBadge}><Ionicons name="car-sport" size={20} color="#fff"/></View></View>:null}{["driver_assigned","arriving"].includes(ride.status)?<View style={styles.shipmentPinCard}><Text style={styles.orderConfirmationEyebrow}>PIN PARA INICIAR</Text>{pickupCode?<><Text style={styles.shipmentPin}>{pickupCode}</Text><Text style={styles.helperText}>Decíselo al conductor sólo cuando estés junto al vehículo correcto.</Text></>:<Pressable style={styles.orderConfirmationAction} onPress={()=>void onRevealCode()}><Ionicons name="key-outline" size={18} color="#fff"/><Text style={styles.orderConfirmationActionText}>Mostrar PIN seguro</Text></Pressable>}</View>:null}<View style={styles.safetyStrip}><View style={styles.safetyIcon}><Ionicons name="shield-checkmark" size={21} color="#087a4b"/></View><View style={styles.itemCopy}><Text style={styles.safetyTitle}>Centro de seguridad</Text><Text style={styles.helperText}>Compartí tu ruta o enviá una alerta vinculada a este viaje.</Text></View></View><Pressable style={styles.orderConfirmationAction} onPress={()=>onShare()}><Ionicons name="share-social-outline" size={18} color="#fff"/><Text style={styles.orderConfirmationActionText}>Compartir seguimiento seguro</Text></Pressable>{contacts.length>0?<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{contacts.map(contact=><Pressable key={contact.id} style={styles.issueCategoryPill} onPress={()=>onShare(contact)}><Ionicons name="person-outline" size={15} color="#7c3cff"/><Text style={styles.issueCategoryText}>{contact.name}</Text></Pressable>)}</ScrollView>:null}<Pressable style={[styles.shareAction,{backgroundColor:"#fff0f0"}]} onPress={onSos}><Ionicons name="warning" size={18} color="#c92626"/><Text style={[styles.shareActionText,{color:"#c92626"}]}>Seguridad Flash · SOS</Text></Pressable><Pressable style={styles.reportIssueButton} onPress={onCancel}><Ionicons name="close-circle-outline" size={18} color="#8f3840"/><Text style={styles.reportIssueText}>Cancelar viaje</Text><Ionicons name="chevron-forward" size={17} color="#a29aa5"/></Pressable></ScrollView></View></View></Modal>;
}

function ServiceChatModal({jobId,currentUserId,onClose}:{jobId:string|null;currentUserId:string;onClose:()=>void}){
  const[messages,setMessages]=useState<ServiceMessage[]>([]),[body,setBody]=useState(""),[loading,setLoading]=useState(false),[sending,setSending]=useState(false),[error,setError]=useState("");
  const[pendingAttachment,setPendingAttachment]=useState<{fileName:string;mimeType:"image/jpeg"|"image/png"|"application/pdf";contentBase64:string;sizeBytes:number}|null>(null);
  const[quickReplies,setQuickReplies]=useState<string[]>([]);
  const load=useCallback(async()=>{if(!jobId)return;try{const result=await api.getServiceMessages(jobId);setMessages(result.messages);if(result.unreadCount>0)await api.markServiceMessagesRead(jobId);setError("");}catch(loadError){setError(loadError instanceof Error?loadError.message:"No se pudo abrir la conversación");}},[jobId]);
  useEffect(()=>{if(!jobId){setMessages([]);return;}setLoading(true);void load().finally(()=>setLoading(false));const timer=setInterval(()=>void load(),3000);return()=>clearInterval(timer);},[jobId,load]);
  useEffect(()=>{if(!jobId){setQuickReplies([]);return;}void api.getServiceQuickReplies(jobId).then(result=>setQuickReplies(result.quickReplies.map(entry=>entry.body))).catch(()=>setQuickReplies([]));},[jobId]);
  const pickAttachment=async()=>{const result=await DocumentPicker.getDocumentAsync({type:["image/jpeg","image/png","application/pdf"],copyToCacheDirectory:true,multiple:false});if(result.canceled)return;const asset=result.assets[0],mimeType=asset.mimeType as "image/jpeg"|"image/png"|"application/pdf";if(!["image/jpeg","image/png","application/pdf"].includes(mimeType)){setError("Formato no permitido");return;}if(!asset.size||asset.size>768000){setError("El adjunto debe pesar menos de 750 KB");return;}const contentBase64=await FileSystem.readAsStringAsync(asset.uri,{encoding:FileSystem.EncodingType.Base64});setPendingAttachment({fileName:asset.name||"adjunto",mimeType,contentBase64,sizeBytes:asset.size});setError("");};
  const openAttachment=async(id:string)=>{try{const result=await api.getServiceAttachmentContent(id),safe=result.attachment.fileName.replace(/[^a-zA-Z0-9._-]/g,"_")||"adjunto",uri=`${FileSystem.cacheDirectory}${id}-${safe}`;await FileSystem.writeAsStringAsync(uri,result.contentBase64,{encoding:FileSystem.EncodingType.Base64});if(await Sharing.isAvailableAsync())await Sharing.shareAsync(uri,{mimeType:result.attachment.mimeType,dialogTitle:"Abrir adjunto seguro"});else Alert.alert("Flash","El dispositivo no permite abrir este adjunto.");}catch(openError){setError(openError instanceof Error?openError.message:"No se pudo abrir el adjunto");}};
  const send=async()=>{if(!jobId||(!body.trim()&&!pendingAttachment)||sending)return;setSending(true);try{await api.sendServiceMessage(jobId,body.trim(),pendingAttachment?{fileName:pendingAttachment.fileName,mimeType:pendingAttachment.mimeType,contentBase64:pendingAttachment.contentBase64}:undefined);setBody("");setPendingAttachment(null);await load();}catch(sendError){setError(sendError instanceof Error?sendError.message:"No se pudo enviar");}finally{setSending(false);}};
  return <Modal visible={Boolean(jobId)} transparent animationType="slide" onRequestClose={onClose}><View style={styles.trackingBackdrop}><View style={styles.trackingSheet}><View style={styles.trackingHeader}><View><Text style={styles.orderConfirmationEyebrow}>CHAT DEL SERVICIO</Text><Text style={styles.foodRestaurantTitle}>{jobId}</Text></View><Pressable style={styles.foodBack} onPress={onClose}><Ionicons name="close" size={21} color="#222"/></Pressable></View><View style={styles.issueSecurityNote}><Ionicons name="lock-closed-outline" size={18} color="#087a50"/><Text style={styles.issueSecurityText}>Mensajes y adjuntos cifrados; sólo participan las personas del servicio.</Text></View><ScrollView style={{flex:1}} contentContainerStyle={styles.supportMessages}>{loading?<ActivityIndicator color="#7c3cff"/>:messages.length===0?<View style={styles.foodEmpty}><Ionicons name="chatbubbles-outline" size={42} color="#7c3cff"/><Text style={styles.cardText}>Todavía no hay mensajes.</Text></View>:messages.map(message=>{const own=message.senderId===currentUserId,read=own&&message.readBy.some(entry=>entry.userId!==currentUserId);return <View key={message.id} style={[styles.supportMessage,own?styles.supportMessageOwn:styles.supportMessageStaff]}>{message.body?<Text style={[styles.supportMessageText,own&&styles.supportMessageTextOwn]}>{message.body}</Text>:null}{message.attachments.map(attachment=><Pressable key={attachment.id} style={styles.issueCategoryPill} onPress={()=>void openAttachment(attachment.id)}><Ionicons name={attachment.mimeType==="application/pdf"?"document-text-outline":"image-outline"} size={16} color={own?"#fff":"#7c3cff"}/><Text style={[styles.issueCategoryText,own&&styles.supportMessageTextOwn]} numberOfLines={1}>{attachment.fileName} · {Math.ceil(attachment.sizeBytes/1024)} KB</Text></Pressable>)}<Text style={[styles.supportMessageTime,own&&styles.supportMessageTextOwn]}>{own?"Vos":message.senderName} · {new Date(message.createdAt).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}{own?read?" · Leído":" · Enviado":""}</Text></View>;})}</ScrollView>{error?<Text style={styles.complianceRejection}>{error}</Text>:null}<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{quickReplies.map(reply=><Pressable key={reply} style={styles.issueCategoryPill} onPress={()=>setBody(reply)}><Text style={styles.issueCategoryText}>{reply}</Text></Pressable>)}</ScrollView>{pendingAttachment?<View style={styles.issueSecurityNote}><Ionicons name="attach-outline" size={18} color="#7c3cff"/><View style={styles.itemCopy}><Text style={styles.issueSecurityText} numberOfLines={1}>{pendingAttachment.fileName} · {Math.ceil(pendingAttachment.sizeBytes/1024)} KB</Text></View><Pressable onPress={()=>setPendingAttachment(null)}><Ionicons name="close-circle" size={20} color="#8f3840"/></Pressable></View>:null}<View style={styles.supportReplyRow}><Pressable disabled={sending} style={styles.foodBack} onPress={()=>void pickAttachment()}><Ionicons name="attach" size={20} color="#7c3cff"/></Pressable><TextInput style={[styles.input,styles.supportReplyInput]} value={body} onChangeText={setBody} maxLength={1000} placeholder="Escribí un mensaje" multiline/><Pressable disabled={sending||(!body.trim()&&!pendingAttachment)} style={[styles.supportSendButton,(sending||(!body.trim()&&!pendingAttachment))&&styles.disabledButton]} onPress={()=>void send()}><Ionicons name="send" size={18} color="#fff"/></Pressable></View></View></View></Modal>;
}

function ShipmentTrackingSheet({shipment,driver,shipmentReturn,pin,onRevealPin,onClose}:{shipment:Shipment|null;driver:Driver|null;shipmentReturn:ShipmentReturn|null;pin:string|null;onRevealPin:()=>Promise<void>;onClose:()=>void}){
  const[route,setRoute]=useState<RoadRoute|null>(null),[routeError,setRouteError]=useState(""),[evidence,setEvidence]=useState<import("./src/types").DeliveryEvidence[]>([]),[pinBusy,setPinBusy]=useState(false);
  useEffect(()=>{if(!shipment?.pickupLocation||!shipment.destinationLocation){setRoute(null);return;}let cancelled=false;setRouteError("");void Promise.all([api.route(shipment.pickupLocation,shipment.destinationLocation),api.getShipmentDeliveryEvidence(shipment.id).catch(()=>({evidence:[]}))]).then(([routeResult,evidenceResult])=>{if(!cancelled){setRoute(routeResult.route);setEvidence(evidenceResult.evidence);}}).catch(()=>{if(!cancelled)setRouteError("No pudimos cargar la ruta; el estado operativo sigue actualizado.");});return()=>{cancelled=true;};},[shipment?.id,shipment?.pickupLocation?.lat,shipment?.pickupLocation?.lng,shipment?.destinationLocation?.lat,shipment?.destinationLocation?.lng,shipment?.deliveryEvidenceCount]);
  const hasMap=Boolean(shipment?.pickupLocation&&shipment.destinationLocation);
  if(!shipment)return null;const stages=["requested","driver_assigned","arriving","picked_up","delivering","delivered"],labels=["Solicitado","Conductor asignado","Retirando","Paquete retirado","En camino","Entregado"],current=Math.max(0,stages.indexOf(shipment.status)),photo=evidence.find(entry=>entry.type==="photo"),signature=evidence.find(entry=>entry.type==="signature");
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.trackingBackdrop}><View style={styles.trackingSheet}><View style={styles.trackingHeader}><View><Text style={styles.orderConfirmationEyebrow}>ENVÍO EN VIVO</Text><Text style={styles.foodRestaurantTitle}>{shipment.id}</Text></View><Pressable style={styles.foodBack} onPress={onClose}><Ionicons name="close" size={21} color="#222"/></Pressable></View>{hasMap?<FlashNativeMap origin={shipment.pickupLocation!} destination={shipment.destinationLocation!} route={route?.coordinates||[]} driver={driver?.location||null} routeColor="#087a50" driverIcon="bicycle" caption={route?`${route.distanceKm} km · ${route.durationMin} min de recorrido`:routeError||"Calculando ruta real…"} detail={driver?`${driver.name} · ${driver.vehicle}`:"Buscando conductor disponible"} accessibilityLabel="Mapa interactivo del envío"/>:<NativeMapUnavailable message={routeError||"El retiro o la entrega todavía no tienen coordenadas verificadas."}/>}<ScrollView showsVerticalScrollIndicator={false}><View style={styles.trackingStatus}><Text style={styles.foodRestaurantTitle}>{labels[current]}</Text><Text style={styles.cardText}>{shipment.pickup} → {shipment.destination}</Text><View style={styles.trackingProgress}>{labels.map((label,index)=><View style={styles.trackingStage} key={label}><View style={[styles.trackingStageDot,index<=current&&styles.trackingStageDotActive]}>{index<current?<Ionicons name="checkmark" size={11} color="#fff"/>:null}</View><Text style={[styles.trackingStageText,index===current&&styles.trackingStageTextActive]}>{label}</Text></View>)}</View></View><View style={styles.shipmentTrackingSummary}><View><Text style={styles.orderConfirmationEyebrow}>{shipment.serviceLevel?.toUpperCase()} · {shipment.itemCategory?.toUpperCase()}</Text><Text style={styles.sectionTitle}>{shipment.weightKg} kg · {money.format(shipment.fare)}</Text><Text style={styles.cardText}>{shipment.handlingInstructions}</Text></View><View style={styles.shipmentTrackingBadge}><Ionicons name={shipment.protection==="standard"?"shield-checkmark":"cube"} size={20} color="#fff"/></View></View><View style={styles.deliveryProofCard}><View style={styles.deliveryProofIcon}><Ionicons name="finger-print" size={21} color="#fff"/></View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>Prueba de entrega</Text><Text style={styles.cardText}>{photo?"Foto recibida":"Foto pendiente"}{shipment.signatureRequired?` · ${signature?`Firmó ${signature.signerName||"receptor"}`:"firma pendiente"}`:""}</Text></View></View>{shipmentReturn?<View style={styles.returnStatusCard}><Ionicons name="return-down-back" size={18} color="#7c3cff"/><Text style={styles.cardText}>Devolución · {shipmentReturn.status.replaceAll("_"," ")}</Text></View>:null}{!['delivered','cancelled'].includes(shipment.status)&&(pin?<View style={styles.shipmentPinCard}><Text style={styles.orderConfirmationEyebrow}>PIN DE ENTREGA</Text><Text style={styles.shipmentPin}>{pin}</Text><Text style={styles.helperText}>Compartilo únicamente cuando recibas el paquete.</Text></View>:<Pressable style={styles.orderConfirmationAction} disabled={pinBusy} onPress={async()=>{setPinBusy(true);try{await onRevealPin();}catch(error){Alert.alert("Flash",error instanceof Error?error.message:"No se pudo consultar el PIN");}finally{setPinBusy(false);}}}><Ionicons name="key-outline" size={18} color="#fff"/><Text style={styles.orderConfirmationActionText}>{pinBusy?"Consultando…":"Ver PIN de entrega"}</Text></Pressable>)}</ScrollView></View></View></Modal>;
}

function SignatureCaptureModal({visible,onClose,onSave,busy}:{visible:boolean;onClose:()=>void;onSave:(input:{contentBase64:string;signerName:string;signerRelationship:"recipient"|"authorized_person"})=>Promise<void>;busy:boolean}){
  const[paths,setPaths]=useState<string[]>([]),[signerName,setSignerName]=useState(""),[relationship,setRelationship]=useState<"recipient"|"authorized_person">("recipient");
  const canvasRef=useRef<View>(null),pathsRef=useRef<string[]>([]);
  const updatePaths=(next:string[])=>{pathsRef.current=next;setPaths(next);};
  const responder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,onPanResponderGrant:event=>{const{locationX,locationY}=event.nativeEvent;updatePaths([...pathsRef.current,`M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`]);},onPanResponderMove:event=>{const{locationX,locationY}=event.nativeEvent,copy=[...pathsRef.current];if(!copy.length)return;copy[copy.length-1]=`${copy[copy.length-1]} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;updatePaths(copy);}}),[]);
  const save=async()=>{if(signerName.trim().length<2)return Alert.alert("Firma incompleta","Indicá el nombre de quien recibe.");if(!paths.some(path=>path.includes(" L ")))return Alert.alert("Firma incompleta","Pedile al receptor que firme dentro del recuadro.");if(!canvasRef.current)return;const contentBase64=await captureRef(canvasRef,{format:"png",quality:.8,result:"base64"});await onSave({contentBase64,signerName:signerName.trim(),signerRelationship:relationship});updatePaths([]);setSignerName("");};
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.signatureBackdrop}><View style={styles.signatureSheet}><View style={styles.trackingHeader}><View><Text style={styles.orderConfirmationEyebrow}>RECEPCIÓN VERIFICADA</Text><Text style={styles.foodRestaurantTitle}>Firma del receptor</Text></View><Pressable style={styles.foodBack} onPress={onClose}><Ionicons name="close" size={21} color="#222"/></Pressable></View><Text style={styles.cardText}>Declaro haber recibido el envío. La firma, identidad declarada, hora y ubicación se guardarán cifradas como evidencia.</Text><TextInput value={signerName} onChangeText={setSignerName} placeholder="Nombre y apellido" style={styles.input}/><View style={styles.signatureRelationshipRow}>{(["recipient","authorized_person"] as const).map(value=><Pressable key={value} style={[styles.signatureChoice,relationship===value&&styles.signatureChoiceActive]} onPress={()=>setRelationship(value)}><Text style={relationship===value?styles.signatureChoiceTextActive:styles.signatureChoiceText}>{value==="recipient"?"Destinatario":"Persona autorizada"}</Text></Pressable>)}</View><View ref={canvasRef} collapsable={false} style={styles.signatureCanvas} {...responder.panHandlers}><Svg style={StyleSheet.absoluteFill}>{paths.map((path,index)=><Path key={index} d={path} stroke="#17131c" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round"/>)}</Svg><Text pointerEvents="none" style={styles.signatureGuide}>{paths.length?"":"Firmar aquí"}</Text></View><View style={styles.signatureActions}><Pressable style={styles.secondaryButton} disabled={busy} onPress={()=>updatePaths([])}><Text style={styles.secondaryButtonText}>Limpiar</Text></Pressable><Pressable style={[styles.primaryButton,{flex:1},busy&&styles.disabledButton]} disabled={busy} onPress={()=>void save()}><Text style={styles.primaryButtonText}>{busy?"Cifrando…":"Guardar firma"}</Text></Pressable></View></View></View></Modal>;
}

function MobileNetworkStatus({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <View style={styles.networkStatusBanner} accessibilityRole="alert">
      <View style={styles.networkStatusIcon}>
        <Ionicons name="cloud-offline-outline" size={18} color="#fff" />
      </View>
      <View style={styles.networkStatusCopy}>
        <Text style={styles.networkStatusTitle}>Sin conexión</Text>
        <Text style={styles.networkStatusText}>
          Las acciones nuevas esperan hasta recuperar internet.
        </Text>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [mode, setMode] = useState<Mode>("customer");
  const [state, setState] = useState<AppState | null>(null);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const networkState = Network.useNetworkState();
  const networkOnline =
    networkState.isConnected !== false && networkState.isInternetReachable !== false;
  const previousNetwork = useRef(networkOnline);
  const lastAppHomeAnalyticsKey = useRef("");

  useEffect(() => configureAnalytics((events) => api.sendAnalyticsEvents(events)), []);

  useEffect(() => {
    if (!sessionUser) return;
    const surface = mode === "driver" ? "driver_app" : mode === "merchant" ? "merchant_app" : "customer_app";
    const key = `${sessionUser.id}:${surface}`;
    if (lastAppHomeAnalyticsKey.current === key) return;
    lastAppHomeAnalyticsKey.current = key;
    track("home_viewed", surface, { mode });
  }, [mode, sessionUser]);

  const refresh = useCallback(async () => {
    const response = await api.state();
    setState(response.state);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const user = await api.restoreSession();
      if (user) {
        setSessionUser(user);
        setMode(
          user.roles.includes("driver")
            ? "driver"
            : user.roles.includes("merchant")
              ? "merchant"
              : "customer",
        );
        await refresh();
      }
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo cargar",
      );
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const wasOnline = previousNetwork.current;
    previousNetwork.current = networkOnline;
    if (!wasOnline && networkOnline && sessionUser) {
      void refresh().catch(() => undefined);
    }
  }, [networkOnline, refresh, sessionUser]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      try {
        await action();
        await refresh();
        Alert.alert("Flash", success);
      } catch (error) {
        Alert.alert(
          "Flash",
          error instanceof Error ? error.message : "No se pudo completar",
        );
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const login = async (email: string, password: string) => {
    setBusy(true);
    try {
      const user = await api.login(email, password);
      setSessionUser(user);
      setMode(
        user.roles.includes("driver")
          ? "driver"
          : user.roles.includes("merchant")
            ? "merchant"
            : "customer",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const register = async (input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => {
    setBusy(true);
    try {
      return await api.register(input);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await stopDriverBackgroundLocation().catch(()=>undefined);
    await api.logout();
    setSessionUser(null);
    setState(null);
  };

  const activeRestaurant =
    state?.restaurants.find(
      (restaurant) => restaurant.id === sessionUser?.restaurantId,
    ) || null;
  const activeDriver =
    state?.drivers.find((driver) => driver.id === sessionUser?.driverId) ||
    null;
  const activeUser =
    state?.users.find((user) => user.id === sessionUser?.id) || sessionUser;

  if (!loading && !sessionUser)
    return (
      <SafeAreaView style={styles.loginSafeArea}>
        <View style={[styles.appViewport, styles.customerViewport]}>
          <LoginScreen busy={busy} onLogin={login} onRegister={register} />
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView
      style={[styles.root, mode === "customer" && styles.customerRoot]}
    >
      <View
        style={[
          styles.appViewport,
          mode === "customer"
            ? styles.customerViewport
            : styles.operationsViewport,
        ]}
      >
        <MobileNetworkStatus online={networkOnline} />
        {mode === "merchant" && (
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Flash Negocios</Text>
              <Text style={styles.title}>Control en vivo de tu local</Text>
            </View>
            <Pressable onPress={logout} style={styles.logoutButton}>
              <Text style={styles.logoutText}>Salir</Text>
            </Pressable>
          </View>
        )}

        {mode === "merchant" && (
          <View style={styles.sessionBar}>
            <Text style={styles.sessionRole}>Cuenta comercio</Text>
            <Text style={styles.sessionName} numberOfLines={1}>
              {sessionUser?.name}
            </Text>
          </View>
        )}

        {loading || !state ? (
          <View style={styles.loader}>
            <ActivityIndicator color="#f4511e" />
            <Text style={styles.muted}>Conectando con backend...</Text>
          </View>
        ) : mode === "customer" && activeUser ? (
          <CustomerScreen
            state={state}
            user={activeUser}
            busy={busy}
            runAction={runAction}
            refresh={refresh}
            onLogout={logout}
          />
        ) : mode === "driver" && activeDriver ? (
          <DriverScreen
            state={state}
            driver={activeDriver}
            busy={busy}
            runAction={runAction}
            onLogout={logout}
            onRefresh={refresh}
          />
        ) : mode === "merchant" && activeRestaurant ? (
          <MerchantScreen
            restaurant={activeRestaurant}
            orders={state.orders}
            busy={busy}
            runAction={runAction}
            onRefresh={refresh}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

type MobileCartLine = {
  lineId:string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  extras:string[];
  note:string;
};

function CustomerScreen({
  state,
  user,
  busy,
  runAction,
  refresh,
  onLogout,
}: {
  state: AppState;
  user: User;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  refresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const customerScrollRef = useRef<ScrollView>(null);
  const [customerWindow, setCustomerWindow] = useState<
    "food" | "ride" | "shipment"
  >("food");
  const [sharedView, setSharedView] = useState<
    "service" | "activity" | "account"
  >("service");
  const [foodScreen, setFoodScreen] = useState<
    "home" | "search" | "restaurant" | "cart" | "checkout" | "orders"
  >("home");
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<
    string | null
  >(null);
  const lastActivityAnalyticsKey = useRef("");
  const previousFoodQuery = useRef("");
  const previousCartCount = useRef<number | null>(null);
  useEffect(() => {
    customerScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [foodScreen, customerWindow, sharedView]);
  const [foodQuery, setFoodQuery] = useState("");
  type CatalogSearchResult={restaurantId:string;restaurantName:string;cuisine:string;image:string;cover:string;etaMin:number;deliveryFee:number;matchedItems:Array<{id:string;name:string;category:string}>;matchCount:number;score:number};
  const[catalogResults,setCatalogResults]=useState<CatalogSearchResult[]>([]),[catalogSearchLoading,setCatalogSearchLoading]=useState(false),[catalogSearchError,setCatalogSearchError]=useState(""),[catalogNextOffset,setCatalogNextOffset]=useState<number|null>(null);
  const[catalogSearchNonce,setCatalogSearchNonce]=useState(0);
  const [foodCategory, setFoodCategory] = useState("Todos");
  const [foodMenuCategory,setFoodMenuCategory]=useState("Todos");
  const [favoriteRestaurantIds,setFavoriteRestaurantIds]=useState<string[]>(state.favoriteRestaurantIds||[]);
  const [favoritePendingId,setFavoritePendingId]=useState<string|null>(null);
  useEffect(()=>setFavoriteRestaurantIds(state.favoriteRestaurantIds||[]),[state.favoriteRestaurantIds]);
  const foodCategories=useMemo(()=>{
    const restaurants=state.restaurants.filter(restaurant=>restaurant.open);
    const byCuisine=new Map<string,{name:string;image:string;count:number}>();
    for(const restaurant of restaurants){
      const name=restaurant.cuisine.trim()||"Otros";
      const current=byCuisine.get(name);
      byCuisine.set(name,{name,image:current?.image||restaurant.image||restaurant.cover,count:(current?.count||0)+1});
    }
    return [{name:"Todos",image:restaurants[0]?.image||restaurants[0]?.cover||"",count:restaurants.length},...Array.from(byCuisine.values()).sort((left,right)=>right.count-left.count||left.name.localeCompare(right.name,"es"))];
  },[state.restaurants]);
  const activeFoodPromotion=useMemo(()=>state.promotions?.find(promotion=>promotion.active&&promotion.service==="food")||null,[state.promotions]);
  const foodPromotionValue=activeFoodPromotion?(activeFoodPromotion.kind==="free_delivery"?"Envío bonificado":activeFoodPromotion.kind==="fixed"?`${money.format(activeFoodPromotion.value||0)} menos`:activeFoodPromotion.kind==="wallet_credit"?`${money.format(activeFoodPromotion.value||0)} en Wallet`:`${activeFoodPromotion.discountPercent||activeFoodPromotion.value||0}% menos`):"";
  const [dietaryPreferences,setDietaryPreferences]=useState<DietaryPreferences>({dietaryLabels:[],avoidedAllergens:[],hideIncompatible:false});
  const itemMatchesDiet=(item:Restaurant["menu"][number])=>{const itemDiets=new Set((item.dietaryLabels||[]).map(entry=>entry.code)),itemAllergens=new Set((item.allergens||[]).map(entry=>entry.code));return dietaryPreferences.dietaryLabels.every(entry=>itemDiets.has(entry.code))&&!dietaryPreferences.avoidedAllergens.some(entry=>itemAllergens.has(entry.code));};
  const openRestaurants = state.restaurants.filter(
    (restaurant) =>
      restaurant.open &&
      (foodCategory === "Todos" ||
        restaurant.cuisine
          .toLowerCase()
          .includes(foodCategory.toLowerCase())) &&
      (!dietaryPreferences.hideIncompatible||restaurant.menu.some(item=>item.stock&&itemMatchesDiet(item))) &&
      (!foodQuery.trim() ||
        `${restaurant.name} ${restaurant.cuisine} ${restaurant.menu.map((item) => item.name).join(" ")}`
          .toLowerCase()
          .includes(foodQuery.trim().toLowerCase())),
  );
  const favoriteRestaurants=openRestaurants.filter(restaurant=>favoriteRestaurantIds.includes(restaurant.id));
  const [cart, setCart] = useState<MobileCartLine[]>([]);
  const[lastCreatedOrder,setLastCreatedOrder]=useState<Order|null>(null);
  const [cartHydrated,setCartHydrated]=useState(false);
  const [customizingItem,setCustomizingItem]=useState<Restaurant["menu"][number]|null>(null);
  const [customizingRestaurant,setCustomizingRestaurant]=useState<Restaurant|null>(null);
  const [customizingExtras,setCustomizingExtras]=useState<string[]>([]);
  const [customizingNote,setCustomizingNote]=useState("");
  const toggleFavorite=async(restaurantId:string)=>{
    if(favoritePendingId)return;
    const favorite=!favoriteRestaurantIds.includes(restaurantId);
    setFavoritePendingId(restaurantId);
    try{
      const result=await api.setFavorite(restaurantId,favorite);
      setFavoriteRestaurantIds(result.restaurantIds);
    }catch(error){
      Alert.alert("No pudimos actualizar favoritos",error instanceof Error?error.message:"Intentá nuevamente.");
    }finally{
      setFavoritePendingId(null);
    }
  };
  useEffect(()=>{let cancelled=false;setCartHydrated(false);void api.cart().then(result=>{if(cancelled)return;setCart(result.cart.map(line=>({lineId:`${line.item.id}:${line.extras.slice().sort().join(",")}:${line.note}`,restaurantId:line.restaurantId,menuItemId:line.item.id,name:line.item.name,unitPrice:line.item.price,quantity:line.quantity,extras:line.extras,note:line.note})));setCartHydrated(true);}).catch(()=>{if(!cancelled)setCartHydrated(true);});return()=>{cancelled=true;};},[user.id]);
  useEffect(()=>{if(!cartHydrated)return;const timer=setTimeout(()=>{void api.saveMobileCart(cart[0]?.restaurantId,cart.map(line=>({menuItemId:line.menuItemId,quantity:line.quantity,extras:line.extras,note:line.note}))).catch(()=>undefined);},250);return()=>clearTimeout(timer);},[cart,cartHydrated]);
  useEffect(() => {
    if (sharedView !== "activity") return;
    const key = `${user.id}:${customerWindow}`;
    if (lastActivityAnalyticsKey.current === key) return;
    lastActivityAnalyticsKey.current = key;
    track("activity_viewed", "customer_app", { service: customerWindow });
  }, [customerWindow, sharedView, user.id]);
  useEffect(() => {
    const trimmedQuery = foodQuery.trim();
    if (trimmedQuery && !previousFoodQuery.current.trim()) {
      track("search_started", "customer_app", { service: "food" });
    }
    previousFoodQuery.current = foodQuery;
  }, [foodQuery]);
  useEffect(() => {
    if (selectedRestaurantId) {
      track("merchant_viewed", "customer_app", { merchant_id: selectedRestaurantId });
    }
  }, [selectedRestaurantId]);
  useEffect(() => {
    if (!cartHydrated) return;
    const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
    if (previousCartCount.current !== null && previousCartCount.current !== itemCount) {
      track("cart_updated", "customer_app", { item_count: itemCount });
    }
    previousCartCount.current = itemCount;
  }, [cart, cartHydrated]);
  useEffect(() => {
    if (foodScreen === "checkout") track("checkout_started", "customer_app", { service: "food" });
  }, [foodScreen]);
  const [deliveryAddress, setDeliveryAddress] = useState(
    user.defaultAddress || "",
  );
  const [foodPromotionCode,setFoodPromotionCode]=useState("");
  const [foodCheckoutQuote,setFoodCheckoutQuote]=useState<FoodCheckoutQuote|null>(null);
  const [selectedFoodPaymentId,setSelectedFoodPaymentId]=useState(()=>state.paymentMethods.find(method=>method.userId===user.id&&method.isDefault)?.id||state.paymentMethods.find(method=>method.userId===user.id)?.id||"");
  const [newAddressLabel,setNewAddressLabel]=useState("Casa");
  const [newAddressText,setNewAddressText]=useState("");
  const [paymentToken,setPaymentToken]=useState("");
  const [paymentBrand,setPaymentBrand]=useState<"visa"|"mastercard"|"amex"|"cabal">("visa");
  const [paymentLast4,setPaymentLast4]=useState("");
  const [paymentExpiry,setPaymentExpiry]=useState("");
  const [notifications,setNotifications]=useState<AppNotification[]>([]);
  const [accountSessions,setAccountSessions]=useState<import("./src/types").AccountSession[]>([]);
  const [phoneVerificationCode,setPhoneVerificationCode]=useState("");
  const [phoneVerified,setPhoneVerified]=useState(Boolean(user.phoneVerifiedAt));
  const [phoneRetrySeconds,setPhoneRetrySeconds]=useState(0);
  const [referral,setReferral]=useState<import("./src/types").ReferralSummary|null>(null);
  const [referralClaim,setReferralClaim]=useState("");
  const [notificationPreferences,setNotificationPreferences]=useState<NotificationPreference[]>([]);
  const [supportSubject,setSupportSubject]=useState("");
  const [supportBody,setSupportBody]=useState("");
  const [supportCategory,setSupportCategory]=useState<"food"|"ride"|"shipment"|"payment"|"account"|"safety"|"other">("food");
  const [supportReplies,setSupportReplies]=useState<Record<string,string>>({});
  useEffect(()=>{let cancelled=false;api.getDietaryPreferences().then(result=>{if(!cancelled)setDietaryPreferences(result.preferences);}).catch(()=>{});return()=>{cancelled=true;};},[user.id]);
  useEffect(()=>{if(foodScreen!=="search")return;let cancelled=false;setCatalogSearchLoading(true);setCatalogSearchError("");const timer=setTimeout(()=>{void api.searchCatalog(foodQuery,0).then(result=>{if(!cancelled){setCatalogResults(result.results);setCatalogNextOffset(result.nextOffset);}}).catch(error=>{if(!cancelled){setCatalogResults([]);setCatalogSearchError(error instanceof Error?error.message:"No se pudo buscar");}}).finally(()=>{if(!cancelled)setCatalogSearchLoading(false);});},250);return()=>{cancelled=true;clearTimeout(timer);};},[foodScreen,foodQuery,catalogSearchNonce,dietaryPreferences.hideIncompatible,dietaryPreferences.dietaryLabels,dietaryPreferences.avoidedAllergens]);
  useEffect(()=>{if(sharedView!=="account")return;let cancelled=false;Promise.all([api.getNotifications(),api.getNotificationPreferences(),api.getDietaryPreferences(),api.getReferralSummary(),api.getAccountSessions()]).then(([inbox,settings,dietary,referrals,sessions])=>{if(!cancelled){setNotifications(inbox.notifications);setNotificationPreferences(settings.preferences);setDietaryPreferences(dietary.preferences);setReferral(referrals.referral);setAccountSessions(sessions.sessions);}}).catch(()=>{});return()=>{cancelled=true;};},[sharedView]);
  useEffect(()=>{if(phoneRetrySeconds<=0)return;const timer=setInterval(()=>setPhoneRetrySeconds(value=>Math.max(0,value-1)),1000);return()=>clearInterval(timer);},[phoneRetrySeconds>0]);
  const [pickup, setPickup] = useState(
    user.defaultAddress || "Ubicacion actual",
  );
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<GeoPoint | null>(
    null,
  );
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [activeRoadStep, setActiveRoadStep] = useState(0);
  const [rideService, setRideService] = useState<RideService>("economy");
  const [rideQuote, setRideQuote] = useState<RideQuote | null>(null);
  const [rideOptions, setRideOptions] = useState<RideQuote[]>([]);
  const [rideDestinations,setRideDestinations]=useState<RideDestination[]>([]);
  const [rideTrustedContacts,setRideTrustedContacts]=useState<RideTrustedContact[]>([]),[trustedContactName,setTrustedContactName]=useState(""),[trustedContactPhone,setTrustedContactPhone]=useState(""),[trustedContactRelationship,setTrustedContactRelationship]=useState<RideTrustedContact["relationship"]>("family");
  useEffect(()=>{let cancelled=false;void api.getRideDestinations().then(result=>{if(!cancelled)setRideDestinations(result.destinations);}).catch(()=>{if(!cancelled)setRideDestinations([]);});return()=>{cancelled=true;};},[user.id]);
  useEffect(()=>{let cancelled=false;void api.getRideTrustedContacts().then(result=>{if(!cancelled)setRideTrustedContacts(result.contacts);}).catch(()=>{if(!cancelled)setRideTrustedContacts([]);});return()=>{cancelled=true;};},[user.id]);
  const rideQuickPlaces=useMemo(()=>{const saved=state.addresses.filter(item=>item.userId===user.id&&item.lat!==null&&item.lng!==null).map(item=>({id:`saved-${item.id}`,icon:item.label.toLowerCase().includes("trab")?"briefcase":"home",label:item.label,address:item.address,point:{lat:item.lat!,lng:item.lng!},recentId:null as string|null})),savedKeys=new Set(saved.map(item=>item.address.trim().toLowerCase())),recent=rideDestinations.filter(item=>!savedKeys.has(item.address.trim().toLowerCase())).map(item=>({id:`recent-${item.id}`,icon:"time",label:item.label,address:item.address,point:item.point,recentId:item.id}));return[...saved,...recent].slice(0,8);},[state.addresses,user.id,rideDestinations]);
  const [rideSchedule, setRideSchedule] = useState<"now" | "hour" | "tomorrow">(
    "now",
  );
  const [locationMessage, setLocationMessage] = useState("");
  const [shipmentPickup, setShipmentPickup] = useState(
    user.defaultAddress || "",
  );
  const [shipmentDestination, setShipmentDestination] = useState(
    "",
  );
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageSize, setPackageSize] = useState<"small" | "medium" | "large">(
    "small",
  );
  const [packageWeight, setPackageWeight] = useState("1");
  const[declaredValue,setDeclaredValue]=useState("0"),[shipmentProtection,setShipmentProtection]=useState<"none"|"standard">("none"),[shipmentSignatureRequired,setShipmentSignatureRequired]=useState(false),[shipmentItemCategory,setShipmentItemCategory]=useState<NonNullable<Shipment["itemCategory"]>>("standard"),[shipmentServiceLevel,setShipmentServiceLevel]=useState<NonNullable<Shipment["serviceLevel"]>>("standard"),[shipmentPickupCoords,setShipmentPickupCoords]=useState<GeoPoint|null>(null),[shipmentDestinationCoords,setShipmentDestinationCoords]=useState<GeoPoint|null>(null),[shipmentRoadRoute,setShipmentRoadRoute]=useState<RoadRoute|null>(null);
  const defaultLocationSeededForUser=useRef("");
  useEffect(()=>{
    if(defaultLocationSeededForUser.current===user.id)return;
    const locatedAddresses=state.addresses.filter(item=>item.userId===user.id&&item.lat!==null&&item.lng!==null);
    const normalizedDefaultAddress=user.defaultAddress?.trim().toLowerCase();
    const primaryAddress=locatedAddresses.find(item=>item.isDefault)||locatedAddresses.find(item=>normalizedDefaultAddress&&item.address.trim().toLowerCase()===normalizedDefaultAddress);
    if(!primaryAddress)return;
    defaultLocationSeededForUser.current=user.id;
    const point={lat:primaryAddress.lat!,lng:primaryAddress.lng!};
    if(!pickupCoords&&(!pickup.trim()||pickup===user.defaultAddress||pickup==="Ubicacion actual")){
      setPickup(primaryAddress.address);
      setPickupCoords(point);
    }
    if(!shipmentPickupCoords&&(!shipmentPickup.trim()||shipmentPickup===user.defaultAddress)){
      setShipmentPickup(primaryAddress.address);
      setShipmentPickupCoords(point);
    }
  },[pickup,pickupCoords,shipmentPickup,shipmentPickupCoords,state.addresses,user.defaultAddress,user.id]);
  const [shipmentQuote, setShipmentQuote] = useState<ShipmentQuote | null>(
    null,
  );
  const[shipmentOptions,setShipmentOptions]=useState<ShipmentOptions|null>(null),[shipmentOptionsError,setShipmentOptionsError]=useState("");
  useEffect(()=>{if(customerWindow!=="shipment")return;let cancelled=false;setShipmentOptionsError("");void api.getShipmentOptions().then(options=>{if(cancelled)return;setShipmentOptions(options);if(!options.categories.some(option=>option.code===shipmentItemCategory)&&options.categories[0])setShipmentItemCategory(options.categories[0].code);if(!options.serviceLevels.some(option=>option.code===shipmentServiceLevel)&&options.serviceLevels[0])setShipmentServiceLevel(options.serviceLevels[0].code);}).catch(error=>{if(!cancelled)setShipmentOptionsError(error instanceof Error?error.message:"No se pudieron cargar las opciones");});return()=>{cancelled=true;};},[customerWindow]);
  const [shipmentCodes, setShipmentCodes] = useState<Record<string, string>>(
    {},
  );
  const [ridePickupCodes,setRidePickupCodes]=useState<Record<string,string>>({});
  const [receipts, setReceipts] = useState<Record<string, ServiceReceipt>>({});
  const[shipmentReturns,setShipmentReturns]=useState<ShipmentReturn[]>([]),[returnShipmentId,setReturnShipmentId]=useState<string|null>(null),[returnReason,setReturnReason]=useState("");
  const[shipmentClaims,setShipmentClaims]=useState<ShipmentClaim[]>([]),[claimShipmentId,setClaimShipmentId]=useState<string|null>(null),[claimType,setClaimType]=useState<ShipmentClaim["claimType"]>("damaged"),[claimDescription,setClaimDescription]=useState(""),[claimAmount,setClaimAmount]=useState("");
  useEffect(()=>{if(sharedView!=="activity")return;let cancelled=false;void api.getShipmentReturns().then(result=>{if(!cancelled)setShipmentReturns(result.returns);}).catch(()=>{});return()=>{cancelled=true;};},[sharedView]);
  useEffect(()=>{if(sharedView!=="activity")return;let cancelled=false;void api.getShipmentClaims().then(result=>{if(!cancelled)setShipmentClaims(result.claims);}).catch(()=>{});return()=>{cancelled=true;};},[sharedView]);
  const attachClaimEvidence=async(claimId:string)=>{const result=await DocumentPicker.getDocumentAsync({type:["image/jpeg","image/png","application/pdf"],copyToCacheDirectory:true,multiple:false});if(result.canceled)return;const asset=result.assets[0],mimeType=asset.mimeType as "image/jpeg"|"image/png"|"application/pdf";if(!["image/jpeg","image/png","application/pdf"].includes(mimeType)){Alert.alert("Formato no permitido","Elegí una foto JPEG/PNG o un PDF.");return;}if(!asset.size||asset.size>768000){Alert.alert("Archivo demasiado grande","La evidencia debe pesar hasta 750 KB.");return;}const contentBase64=await FileSystem.readAsStringAsync(asset.uri,{encoding:FileSystem.EncodingType.Base64}),uploaded=(await api.addShipmentClaimEvidence(claimId,{fileName:asset.name||"evidencia",mimeType,contentBase64})).evidence;setShipmentClaims(current=>current.map(claim=>claim.id===claimId?{...claim,evidence:[...(claim.evidence||[]),uploaded]}:claim));};
  const openClaimEvidence=async(id:string)=>{const result=await api.getShipmentClaimEvidenceContent(id),safe=result.evidence.fileName.replace(/[^a-zA-Z0-9._-]/g,"_")||"evidencia",uri=`${FileSystem.cacheDirectory}${id}-${safe}`;await FileSystem.writeAsStringAsync(uri,result.contentBase64,{encoding:FileSystem.EncodingType.Base64});if(await Sharing.isAvailableAsync())await Sharing.shareAsync(uri,{mimeType:result.evidence.mimeType,dialogTitle:"Abrir evidencia cifrada"});else Alert.alert("Flash","El dispositivo no permite abrir este archivo.");};
  const [issueOrderId,setIssueOrderId]=useState<string|null>(null);
  const [issueCategory,setIssueCategory]=useState<"missing_item"|"wrong_item"|"damaged_item"|"quality"|"late"|"other">("missing_item");
  const [issueDescription,setIssueDescription]=useState("");
  const [issueRefund,setIssueRefund]=useState("");
  const[trackingOrderId,setTrackingOrderId]=useState<string|null>(null);
  const[trackingRideId,setTrackingRideId]=useState<string|null>(null);
  const[trackingShipmentId,setTrackingShipmentId]=useState<string|null>(null);
  const[chatJobId,setChatJobId]=useState<string|null>(null);
  const[activityItems,setActivityItems]=useState<Array<{id:string;kind:"order"|"ride"|"shipment";createdAt:string;resource:Order|Ride|Shipment}>|null>(null),[activityCursor,setActivityCursor]=useState<string|null>(null),[activityLoading,setActivityLoading]=useState(false);
  const loadActivity=useCallback(async(append=false)=>{if(activityLoading)return;setActivityLoading(true);try{const result=await api.getActivity(append?activityCursor||undefined:undefined,20);setActivityItems(current=>append&&current?[...current,...result.items]:result.items);setActivityCursor(result.nextCursor);}finally{setActivityLoading(false);}},[activityCursor,activityLoading]);
  useEffect(()=>{if(sharedView==="activity")void loadActivity(false);},[sharedView,user.id]);
  useEffect(()=>{if(!trackingRideId)return;void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[trackingRideId,refresh]);
  const activityOrders=(activityItems?.filter(item=>item.kind==="order").map(item=>item.resource as Order))||state.orders;
  const activityRides=(activityItems?.filter(item=>item.kind==="ride").map(item=>item.resource as Ride))||state.rides;
  const activityShipments=(activityItems?.filter(item=>item.kind==="shipment").map(item=>item.resource as Shipment))||state.shipments;
  const activeOrders = activityOrders.filter(
    (order) =>
      order.customerId === user.id &&
      !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = activityRides.filter(
    (ride) =>
      ride.customerId === user.id &&
      !["completed", "cancelled"].includes(ride.status),
  );
  const activeShipments = activityShipments.filter(
    (shipment) =>
      shipment.customerId === user.id &&
      !["delivered", "cancelled"].includes(shipment.status),
  );
  const [orderSubstitutions,setOrderSubstitutions]=useState<OrderSubstitution[]>([]);
  const activeOrderIds=activeOrders.map(order=>order.id).join(",");
  useEffect(()=>{let cancelled=false;if(sharedView!=="activity"||!activeOrderIds){setOrderSubstitutions([]);return;}void Promise.all(activeOrders.map(order=>api.getOrderSubstitutions(order.id))).then(results=>{if(!cancelled)setOrderSubstitutions(results.flatMap(result=>result.substitutions));}).catch(()=>{if(!cancelled)setOrderSubstitutions([]);});return()=>{cancelled=true;};},[sharedView,activeOrderIds]);
  const pendingSubstitutions=orderSubstitutions.filter(entry=>entry.status==="pending");
  const completedForTips = [
    ...activityOrders
      .filter(
        (order) =>
          order.customerId === user.id &&
          order.status === "delivered" &&
          order.courierId,
      )
      .map((order) => ({
        id: order.id,
        kind:"order" as const,
        label: `Pedido ${order.id}`,
        amount: order.total,
      })),
    ...activityRides
      .filter(
        (ride) =>
          ride.customerId === user.id &&
          ride.status === "completed" &&
          ride.driverId,
      )
      .map((ride) => ({
        id: ride.id,
        kind:"ride" as const,
        label: `Viaje ${ride.pickup} → ${ride.destination}`,
        amount: ride.fare,
      })),
    ...activityShipments
      .filter(
        (shipment) =>
          shipment.customerId === user.id &&
          shipment.status === "delivered" &&
          shipment.driverId,
      )
      .map((shipment) => ({
        id: shipment.id,
        kind:"shipment" as const,
        label: `Envío a ${shipment.destination}`,
        amount: shipment.fare,
      })),
  ].slice(0, 5);
  const recentCancellations = [
    ...state.orders
      .filter((order) => order.customerId === user.id && order.cancellation)
      .map((order) => ({
        label: "Pedido cancelado",
        ...order.cancellation!,
      })),
    ...state.rides
      .filter((ride) => ride.customerId === user.id && ride.cancellation)
      .map((ride) => ({
        label: "Viaje cancelado",
        ...ride.cancellation!,
      })),
    ...state.shipments
      .filter(
        (shipment) => shipment.customerId === user.id && shipment.cancellation,
      )
      .map((shipment) => ({
        label: "Envío cancelado",
        ...shipment.cancellation!,
      })),
  ]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);
  const cancelService = (kind: "order" | "ride" | "shipment", id: string) =>
    Alert.alert(
      "¿Por qué cancelás?",
      "El motivo y el reintegro quedarán registrados.",
      [
        {
          text: "Demora",
          onPress: () =>
            runAction(
              () =>
                kind === "order"
                  ? api.setOrderStatus(id, "cancelled", "long_wait")
                  : kind === "ride"
                    ? api.setRideStatus(id, "cancelled", "long_wait")
                    : api.setShipmentStatus(id, "cancelled", "long_wait"),
              "Servicio cancelado",
            ),
        },
        {
          text:
            kind === "shipment"
              ? "Destinatario no disponible"
              : "Cambié de idea",
          onPress: () =>
            runAction(
              () =>
                kind === "order"
                  ? api.setOrderStatus(id, "cancelled", "changed_mind")
                  : kind === "ride"
                    ? api.setRideStatus(id, "cancelled", "changed_mind")
                    : api.setShipmentStatus(
                        id,
                        "cancelled",
                        "recipient_unavailable",
                      ),
              "Servicio cancelado",
            ),
        },
        { text: "Volver", style: "cancel" },
      ],
    );
  const addItem = (
    restaurant: Restaurant,
    item: Restaurant["menu"][number],
    extras:string[]=[],
    note="",
  ) => {
    if (!item.stock || !restaurant.open) return;
    if (cart.length > 0 && cart[0].restaurantId !== restaurant.id) {
      Alert.alert(
        "Carrito de un comercio",
        "Finaliza o vacia el carrito antes de pedir en otro local.",
      );
      return;
    }
    const lineId=`${item.id}:${extras.slice().sort().join(",")}:${note.trim()}`,modifierPrice=(item.modifierGroups||[]).flatMap(group=>group.modifiers).filter(modifier=>extras.includes(modifier.id)).reduce((sum,modifier)=>sum+modifier.price,0);
    setCart((current) => {
      const existing = current.find((line) => line.lineId === lineId);
      if (existing) {
        return current.map((line) =>
          line.lineId === lineId
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...current,
        {
          lineId,
          restaurantId: restaurant.id,
          menuItemId: item.id,
          name: item.name,
          unitPrice: item.price+modifierPrice,
          quantity: 1,
          extras,
          note:note.trim(),
        },
      ];
    });
  };

  const cartTotal = cart.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  const cartRestaurant = state.restaurants.find(
    (restaurant) => restaurant.id === cart[0]?.restaurantId,
  );
  const customerPaymentMethods=state.paymentMethods.filter(method=>method.userId===user.id);
  const selectedFoodPayment=customerPaymentMethods.find(method=>method.id===selectedFoodPaymentId)||customerPaymentMethods.find(method=>method.isDefault)||customerPaymentMethods[0];
  const selectedRestaurant =
    state.restaurants.find(
      (restaurant) => restaurant.id === selectedRestaurantId,
    ) || null;
  const foodMenuCategories=useMemo(()=>["Todos",...Array.from(new Set((selectedRestaurant?.menu||[]).map(item=>item.category?.trim()||"Otros")))],[selectedRestaurant]);
  useEffect(()=>setFoodMenuCategory("Todos"),[selectedRestaurantId]);
  const visibleFoodMenuItems=(selectedRestaurant?.menu||[]).filter(item=>(foodMenuCategory==="Todos"||(item.category?.trim()||"Otros")===foodMenuCategory)&&(!dietaryPreferences.hideIncompatible||itemMatchesDiet(item)));

  const changeCartQuantity = (lineId: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.lineId === lineId
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const shareStatus = (title: string, message: string) => {
    void Share.share({ title, message });
  };

  const shareRideLive = (ride: Ride, contact?: RideTrustedContact) =>
    runAction(async () => {
      const { link } = await api.createRideTrackingLink(ride.id);
      await Share.share({
        title: "Seguimiento de mi viaje Flash",
        message: `${contact?`${contact.name}, s`:"S"}eguí mi viaje en tiempo real hasta ${ride.destination}: ${link.trackingUrl}\nEl enlace vence ${new Date(link.expiresAt).toLocaleString("es-AR")}.`,
      });
    }, contact?`Enlace seguro listo para ${contact.name}`:"Enlace seguro creado");

  const confirmRideSos = (ride: Ride) => {
    Alert.alert(
      "Activar Seguridad Flash",
      "Se enviará una alerta urgente vinculada al viaje y tu ubicación actual al equipo de operaciones.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar SOS",
          style: "destructive",
          onPress: () =>
            runAction(async () => {
              let location: GeoPoint | undefined;
              try {
                const permission = await Location.requestForegroundPermissionsAsync();
                if (permission.status === "granted") {
                  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                  location = { lat: current.coords.latitude, lng: current.coords.longitude };
                }
              } catch (_error) {
                // La alerta se envía igualmente; ubicación es evidencia opcional.
              }
              await api.createRideSafetyIncident(ride.id, { type: "sos", location });
            }, "SOS enviado a Seguridad Flash"),
        },
      ],
    );
  };

  const selectedFoodAddress=state.addresses.find(item=>item.userId===user.id&&!item.id.startsWith("profile-")&&item.address===deliveryAddress.trim()&&item.lat!==null&&item.lng!==null);
  const foodCheckoutItems=cart.map(line=>({menuItemId:line.menuItemId,quantity:line.quantity,extras:line.extras,note:line.note}));

  const openFoodCheckout=()=>{
    if(!cart.length||!cartRestaurant||!selectedFoodAddress||!selectedFoodPayment){Alert.alert("Checkout incompleto","Seleccioná una dirección geocodificada y un método de pago.");return;}
    runAction(async()=>{const result=await api.quoteFoodCheckout({customerId:user.id,restaurantId:cartRestaurant.id,deliveryAddressId:selectedFoodAddress.id,branchId:cartRestaurant.branches?.find(branch=>branch.isPrimary)?.id,paymentMethod:selectedFoodPayment.label,paymentMethodId:selectedFoodPayment.id,promotionCode:foodPromotionCode.trim().toUpperCase()||undefined,items:foodCheckoutItems});setFoodCheckoutQuote(result.quote);setFoodScreen("checkout");},"Precio final actualizado");
  };

  const createOrder = () => {
    const selectedDeliveryAddress=state.addresses.find(item=>item.userId===user.id&&!item.id.startsWith("profile-")&&item.address===deliveryAddress.trim()&&item.lat!==null&&item.lng!==null);
    if (!cart.length || !cartRestaurant || !deliveryAddress.trim()||!selectedDeliveryAddress||!selectedFoodPayment||!foodCheckoutQuote) {
      Alert.alert(
        "Pedido incompleto",
        "Selecciona productos y una dirección guardada con coordenadas reales.",
      );
      return;
    }
    runAction(async () => {
      const result=await api.createOrder({
        customerId: user.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId:selectedDeliveryAddress.id,
        deliveryAddress: deliveryAddress.trim(),
        paymentMethod:selectedFoodPayment.label,
        paymentMethodId:selectedFoodPayment.id,
        promotionCode:foodCheckoutQuote.promotionCode||undefined,
        quoteToken:foodCheckoutQuote.quoteToken,
        items:foodCheckoutItems,
      });
      setLastCreatedOrder(result.order);
      setCart([]);
      setFoodCheckoutQuote(null);
      setFoodPromotionCode("");
      setFoodScreen("orders");
      track("job_created", "customer_app", { service: "food" });
    }, "Pedido enviado al comercio");
  };

  const useCurrentLocation = async () => {
    setLocationMessage("Solicitando ubicacion...");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationMessage("Permiso de ubicacion rechazado");
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPickup("Ubicacion actual");
      setPickupCoords({
        lat: current.coords.latitude,
        lng: current.coords.longitude,
      });
      setLocationMessage("Origen tomado desde el GPS del dispositivo");
    } catch (_error) {
      setLocationMessage("No se pudo obtener la ubicacion");
    }
  };

  const quoteRide = () => {
    if (!pickup.trim() || !destination.trim()) {
      Alert.alert("Viaje incompleto", "Indica origen y destino para cotizar.");
      return;
    }
    runAction(async () => {
      let resolvedPickup = pickupCoords;
      if (!resolvedPickup) {
        const originResult = await api.geocode(pickup.trim());
        resolvedPickup = originResult.results[0]?.point || null;
      }
      let destinationMatch:{label:string;point:GeoPoint;type:string}|undefined,resolvedDestination=destinationCoords;
      if(!resolvedDestination){const destinationResult=await api.geocode(destination.trim());destinationMatch=destinationResult.results[0];resolvedDestination=destinationMatch?.point||null;}
      if (!resolvedPickup || !resolvedDestination)
        throw new Error("No pudimos ubicar una de las direcciones en el mapa");
      const routed = await api.route(resolvedPickup, resolvedDestination);
      setPickupCoords(resolvedPickup);
      setDestinationCoords(resolvedDestination);
      setRoadRoute(routed.route);
      setActiveRoadStep(0);
      const response = await api.quoteRideOptions({
        pickup: pickup.trim(),
        destination: destination.trim(),
        pickupCoords: resolvedPickup,
        destinationCoords: resolvedDestination,
      });
      setRideOptions(response.options);
      setRideQuote(
        response.options.find((option) => option.service === rideService) ||
          response.options[0],
      );
      track("quote_received", "customer_app", { service: "ride" });
      const recorded=await api.recordRideDestination({label:(destinationMatch?.label||destination.trim()).split(",")[0],address:destinationMatch?.label||destination.trim(),lat:resolvedDestination.lat,lng:resolvedDestination.lng}).catch(()=>null);
      if(recorded)setRideDestinations(recorded.destinations);
    }, "Cotizacion actualizada");
  };

  const requestRide = () => {
    if (!rideQuote?.quoteToken) {
      Alert.alert(
        "Cotiza primero",
        "La tarifa debe confirmarse antes de solicitar el viaje.",
      );
      return;
    }
    const quoteToken = rideQuote.quoteToken;
    const scheduledFor =
      rideSchedule === "hour"
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : rideSchedule === "tomorrow"
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : undefined;
    runAction(
      async () => {
        await api.createRide({
          customerId: user.id,
          pickup: pickup.trim(),
          destination: destination.trim(),
          service: rideService,
          pickupCoords,
          destinationCoords,
          paymentMethod: "Flash Wallet",
          quoteToken,
          scheduledFor,
        });
        track("job_created", "customer_app", { service: "ride" });
      },
      scheduledFor ? "Viaje reservado" : "Viaje solicitado",
    );
  };

  const quoteShipment = () => {
    if (
      !shipmentPickup.trim() ||
      !shipmentDestination.trim() ||
      Number(packageWeight) <= 0
    ) {
      Alert.alert(
        "Envio incompleto",
        "Confirma direcciones y peso del paquete.",
      );
      return;
    }
    runAction(async () => {
      const[pickupResult,destinationResult]=await Promise.all([api.geocode(shipmentPickup.trim()),api.geocode(shipmentDestination.trim())]);const pickupPoint=pickupResult.results[0]?.point,destinationPoint=destinationResult.results[0]?.point;if(!pickupPoint||!destinationPoint)throw new Error("No pudimos ubicar una de las direcciones");setShipmentPickupCoords(pickupPoint);setShipmentDestinationCoords(destinationPoint);const[response,routed]=await Promise.all([api.quoteShipment({
        pickup: shipmentPickup.trim(),
        destination: shipmentDestination.trim(),
        packageSize,
        weightKg: Number(packageWeight),
        declaredValue:Number(declaredValue)||0,protection:shipmentProtection,signatureRequired:shipmentSignatureRequired,itemCategory:shipmentItemCategory,serviceLevel:shipmentServiceLevel,pickupCoords:pickupPoint,
        destinationCoords:destinationPoint,
      }),api.route(pickupPoint,destinationPoint).catch(()=>null)]);
      setShipmentRoadRoute(routed?.route||null);
      setShipmentQuote(response.quote);
      track("quote_received", "customer_app", { service: "shipment" });
    }, "Envio cotizado");
  };

  const createShipment = () => {
    if (
      !shipmentQuote ||
      !recipientName.trim() ||
      !recipientPhone.trim() ||
      !packageDescription.trim()
    ) {
      Alert.alert(
        "Envio incompleto",
        "Cotiza e ingresa destinatario, telefono y contenido general.",
      );
      return;
    }
    runAction(async () => {
      await api.createShipment({
        customerId: user.id,
        pickup: shipmentPickup.trim(),
        destination: shipmentDestination.trim(),
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        packageSize,
        description: packageDescription.trim(),
        weightKg: Number(packageWeight),
        declaredValue:Number(declaredValue)||0,
        protection:shipmentProtection,
        signatureRequired:shipmentSignatureRequired,
        itemCategory:shipmentItemCategory,
        serviceLevel:shipmentServiceLevel,
        deliveryNotes: "Entregar en mano",
        paymentMethod: "Flash Wallet",
        termsAccepted: true,
        pickupCoords: shipmentPickupCoords,
        destinationCoords: shipmentDestinationCoords,
        quoteToken: shipmentQuote.quoteToken,
      });
      track("job_created", "customer_app", { service: "shipment" });
      setShipmentQuote(null);
      setShipmentPickupCoords(null);
      setShipmentDestinationCoords(null);
      setShipmentRoadRoute(null);
      setRecipientName("");
      setRecipientPhone("");
      setPackageDescription("");
    }, "Envio solicitado");
  };

  return (
    <View style={styles.customerShell}>
      <ScrollView
        ref={customerScrollRef}
        contentContainerStyle={[styles.stack, styles.customerScrollContent]}
      >
        <View style={styles.serviceNav}>
          {(["food", "ride", "shipment"] as const).map((entry) => (
            <Pressable
              key={entry}
              onPress={() => {
                setCustomerWindow(entry);
                setSharedView("service");
              }}
              style={[
                styles.serviceNavItem,
                customerWindow === entry && styles.serviceNavItemActive,
              ]}
            >
              <View
                style={[
                  styles.serviceIconBubble,
                  customerWindow === entry && styles.serviceIconBubbleActive,
                ]}
              >
                <Ionicons
                  name={
                    entry === "food"
                      ? "fast-food"
                      : entry === "ride"
                        ? "car-sport"
                        : "cube"
                  }
                  size={20}
                  color={customerWindow === entry ? "#fff" : "#f4511e"}
                />
              </View>
              <Text
                style={[
                  styles.serviceNavText,
                  customerWindow === entry && styles.serviceNavTextActive,
                ]}
              >
                {entry === "food"
                  ? "Comidas"
                  : entry === "ride"
                    ? "Viajes"
                    : "Envios"}
              </Text>
            </Pressable>
          ))}
        </View>

        {sharedView === "service" && customerWindow === "food" && (
          <>
            {foodScreen === "home" && (
              <>
                <View style={styles.foodTopbar}>
                  <View style={styles.foodLocationBlock}>
                    <View style={styles.foodLocationIcon}>
                      <Ionicons name="location" size={18} color={flashDesign.color.food} />
                    </View>
                    <View style={styles.foodLocationCopy}>
                      <Text style={styles.foodDeliverLabel}>ENTREGAR EN</Text>
                      <Text style={styles.foodAddress} numberOfLines={1}>
                        {deliveryAddress || "Elegí una dirección"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.foodTopActions}>
                    <Pressable onPress={()=>setSharedView("account")} style={styles.foodAvatar} accessibilityLabel="Abrir cuenta">
                      <Text style={styles.foodAvatarText}>{user.name.trim().slice(0,1).toUpperCase()}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setFoodScreen("cart")}
                      style={styles.foodCartIcon}
                      accessibilityLabel={`Abrir carrito con ${cart.reduce((sum,line)=>sum+line.quantity,0)} productos`}
                    >
                      <Ionicons name="bag-handle-outline" size={20} color="#fff" />
                      {cart.length > 0 && (
                        <Text style={styles.foodCartCount}>
                          {cart.reduce((sum, line) => sum + line.quantity, 0)}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
                <View style={styles.foodHomeHeading}>
                  <Text style={styles.foodHomeEyebrow}>HOLA, {user.name.split(" ")[0].toUpperCase()}</Text>
                  <Text style={styles.foodHomeTitle}>¿Qué te gustaría pedir?</Text>
                </View>
                {activeFoodPromotion?<LinearGradient colors={[flashDesign.color.ink,"#33253B"]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.foodPromoBanner}>
                  <View style={styles.foodPromoCopy}>
                    <View style={styles.foodPromoBadge}><Ionicons name="sparkles" size={14} color={flashDesign.color.food}/><Text style={styles.foodPromoBadgeText}>{foodPromotionValue}</Text></View>
                    <Text style={styles.foodPromoTitle}>{activeFoodPromotion.title}</Text>
                    <Text style={styles.foodPromoDescription} numberOfLines={2}>{activeFoodPromotion.description}</Text>
                    <Pressable style={styles.foodPromoAction} onPress={()=>{if(activeFoodPromotion.code)setFoodPromotionCode(activeFoodPromotion.code);setFoodScreen(cart.length?"cart":"search");}}>
                      <Text style={styles.foodPromoActionText}>{cart.length?"Ver carrito":"Explorar opciones"}</Text>
                      <Ionicons name="arrow-forward" size={16} color={flashDesign.color.ink}/>
                    </Pressable>
                  </View>
                  <View style={styles.foodPromoArt}><Ionicons name="fast-food" size={45} color="#fff"/><View style={styles.foodPromoArtDot}/></View>
                </LinearGradient>:null}
                <Pressable
                  onPress={() => setFoodScreen("search")}
                  style={styles.foodSearchButton}
                >
                  <Ionicons name="search" size={20} color={flashDesign.color.inkSoft} />
                  <Text style={styles.foodSearchPlaceholder}>
                    Buscar platos, tiendas o restaurantes
                  </Text>
                  <View style={styles.foodSearchFilter}><Ionicons name="options-outline" size={18} color="#fff"/></View>
                </Pressable>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>
                    Todas las categorías
                  </Text>
                  <Text style={styles.foodSeeAll}>Ver todas ›</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.foodCategoryRail}
                >
                  {foodCategories.map((category) => (
                    <Pressable
                      key={category.name}
                      onPress={() => setFoodCategory(category.name)}
                      style={styles.foodCategoryItem}
                      accessibilityState={{selected:foodCategory===category.name}}
                    >
                      <View
                        style={[
                          styles.foodCategoryArt,
                          foodCategory === category.name &&
                            styles.foodCategoryArtActive,
                        ]}
                      >
                        {category.image
                          ? <Image source={{uri:category.image}} style={styles.foodCategoryImage}/>
                          : <Ionicons name="restaurant" size={24} color={flashDesign.color.food}/>
                        }
                      </View>
                      <Text style={[styles.foodCategoryName,foodCategory===category.name&&styles.foodCategoryNameActive]} numberOfLines={2}>{category.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {favoriteRestaurants.length>0?<>
                  <View style={styles.foodSectionHeader}>
                    <Text style={styles.foodSectionTitle}>Tus favoritos</Text>
                    <Text style={styles.foodSeeAll}>{favoriteRestaurants.length} guardados</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.foodFavoriteRail}>
                    {favoriteRestaurants.map(restaurant=><Pressable key={restaurant.id} style={styles.foodFavoriteCard} onPress={()=>{setSelectedRestaurantId(restaurant.id);setFoodScreen("restaurant");}}>
                      <ImageBackground source={{uri:restaurant.cover}} imageStyle={styles.foodFavoriteImageStyle} style={styles.foodFavoriteImage}><View style={styles.foodFavoriteEta}><Ionicons name="time-outline" size={13} color={flashDesign.color.ink}/><Text style={styles.foodFavoriteEtaText}>{restaurant.etaMin} min</Text></View></ImageBackground>
                      <Text style={styles.foodFavoriteName} numberOfLines={1}>{restaurant.name}</Text>
                      <Text style={styles.foodFavoriteMeta} numberOfLines={1}>{restaurant.cuisine}</Text>
                    </Pressable>)}
                  </ScrollView>
                </>:null}
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>
                    {foodCategory==="Todos"?"Elegidos para vos":foodCategory}
                  </Text>
                  <Text style={styles.foodSeeAll}>
                    {openRestaurants.length} abiertos
                  </Text>
                </View>
                {openRestaurants.map((restaurant) => (
                  <Pressable
                    key={restaurant.id}
                    onPress={() => {
                      setSelectedRestaurantId(restaurant.id);
                      setFoodScreen("restaurant");
                    }}
                    style={styles.foodMerchantCard}
                  >
                    <ImageBackground
                      source={{ uri: restaurant.cover }}
                      imageStyle={styles.foodMerchantBannerImage}
                      style={styles.foodCardBannerLarge}
                    >
                      <View style={styles.foodCardTopline}>
                        <Text style={styles.foodCardPromo}>
                          {restaurant.badge}
                        </Text>
                        <Pressable disabled={favoritePendingId===restaurant.id} style={styles.foodHeart} accessibilityLabel={favoriteRestaurantIds.includes(restaurant.id)?`Quitar ${restaurant.name} de favoritos`:`Guardar ${restaurant.name} en favoritos`} accessibilityState={{checked:favoriteRestaurantIds.includes(restaurant.id),busy:favoritePendingId===restaurant.id}} onPress={(event)=>{event.stopPropagation();void toggleFavorite(restaurant.id);}}>
                          <Ionicons
                            name={favoriteRestaurantIds.includes(restaurant.id)?"heart":"heart-outline"}
                            size={19}
                            color={favoriteRestaurantIds.includes(restaurant.id)?flashDesign.color.food:flashDesign.color.ink}
                          />
                        </Pressable>
                      </View>
                    </ImageBackground>
                    <View style={styles.foodMerchantBody}>
                      <View style={styles.foodMerchantTitleRow}>
                        <View style={styles.itemCopy}>
                          <Text style={styles.foodMerchantName} numberOfLines={1}>{restaurant.name}</Text>
                          <Text style={styles.foodMerchantCuisine} numberOfLines={1}>{restaurant.cuisine}</Text>
                        </View>
                        <View style={styles.foodRatingPill}><Ionicons name="star" size={12} color="#E98A00"/><Text style={styles.foodRatingText}>{restaurant.rating.toFixed(1)}</Text></View>
                      </View>
                      <View style={styles.foodMetaRow}>
                        <View style={styles.foodMetaItem}><Ionicons name="time-outline" size={15} color={flashDesign.color.inkSoft}/><Text style={styles.foodMetaText}>{restaurant.etaMin} min</Text></View>
                        <View style={styles.foodMetaDot}/>
                        <View style={styles.foodMetaItem}><Ionicons name="bicycle-outline" size={15} color={flashDesign.color.inkSoft}/><Text style={styles.foodMetaText}>{restaurant.deliveryFee?money.format(restaurant.deliveryFee):"Envío gratis"}</Text></View>
                        <View style={styles.foodMetaDot}/>
                        <Text style={styles.foodMetaText}>{restaurant.distanceKm.toFixed(1)} km</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
                {openRestaurants.length===0?<View style={styles.foodEmpty}><View style={styles.foodEmptyIcon}><Ionicons name="restaurant-outline" size={30} color={flashDesign.color.food}/></View><Text style={styles.foodEmptyTitle}>No hay opciones abiertas</Text><Text style={styles.foodEmptyCopy}>Probá otra categoría o volvé a buscar cuando los comercios estén disponibles.</Text><Pressable style={styles.foodEmptyAction} onPress={()=>setFoodCategory("Todos")}><Text style={styles.foodEmptyActionText}>Ver todas</Text></Pressable></View>:null}
              </>
            )}

            {foodScreen === "search" && (
              <>
                <View style={styles.foodPageHeader}>
                  <Pressable
                    onPress={() => setFoodScreen("home")}
                    style={styles.foodBack}
                  >
                    <Ionicons name="chevron-back" size={20} color="#222" />
                  </Pressable>
                  <View style={styles.foodPageHeaderCopy}>
                    <Text style={styles.foodPageTitle}>Buscar</Text>
                    <Text style={styles.foodPageSubtitle}>Catálogo y disponibilidad actual</Text>
                  </View>
                </View>
                <View style={styles.foodSearchButton}>
                  <Ionicons name="search" size={20} color={flashDesign.color.inkSoft} />
                  <TextInput
                    autoFocus
                    value={foodQuery}
                    onChangeText={setFoodQuery}
                    placeholder="¿Qué querés comer?"
                    style={styles.foodSearchInput}
                  />
                  {foodQuery?<Pressable accessibilityLabel="Limpiar búsqueda" style={styles.foodSearchClear} onPress={()=>setFoodQuery("")}><Ionicons name="close" size={17} color={flashDesign.color.inkSoft}/></Pressable>:null}
                </View>
                <View style={styles.foodSectionHeader}><Text style={styles.foodSectionTitle}>{foodQuery ? "Resultados" : "Explorá el catálogo"}</Text>{!catalogSearchLoading&&!catalogSearchError?<Text style={styles.foodSeeAll}>{catalogResults.length}{catalogNextOffset!==null?"+":""} opciones</Text>:null}</View>
                {!foodQuery && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.foodSearchCategoryRail}>
                    {foodCategories.filter(category=>category.name!=="Todos").slice(0,6).map((category) => (
                      <Pressable
                        key={category.name}
                        onPress={() => setFoodQuery(category.name)}
                        style={styles.foodSearchCategoryCard}
                      >
                        {category.image?<Image source={{uri:category.image}} style={styles.foodSearchCategoryImage}/>:<View style={styles.foodSearchCategoryImageFallback}><Ionicons name="restaurant" size={20} color={flashDesign.color.food}/></View>}
                        <Text style={styles.foodSearchCategoryName} numberOfLines={2}>{category.name}</Text>
                        <Text style={styles.foodSearchCategoryCount}>{category.count} {category.count===1?"lugar":"lugares"}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                {catalogSearchLoading?<View style={styles.foodSearchSkeletonList}>{[0,1,2].map(index=><View key={index} style={styles.foodSearchSkeletonCard}><View style={styles.foodSearchSkeletonImage}/><View style={styles.foodSearchSkeletonCopy}><View style={styles.foodSearchSkeletonTitle}/><View style={styles.foodSearchSkeletonLine}/><View style={styles.foodSearchSkeletonShort}/></View></View>)}</View>:null}
                {Boolean(catalogSearchError)&&<View style={styles.foodSearchState}><View style={styles.foodSearchStateIcon}><Ionicons name="cloud-offline-outline" size={25} color={flashDesign.color.danger}/></View><Text style={styles.foodSearchStateTitle}>No pudimos buscar</Text><Text style={styles.foodSearchStateCopy}>{catalogSearchError}</Text><Pressable style={styles.foodSearchRetry} onPress={()=>setCatalogSearchNonce(current=>current+1)}><Text style={styles.foodSearchRetryText}>Reintentar</Text></Pressable></View>}
                {!catalogSearchLoading&&!catalogSearchError&&!catalogResults.length&&foodQuery.trim()?<View style={styles.foodSearchState}><View style={styles.foodSearchStateIcon}><Ionicons name="search-outline" size={26} color={flashDesign.color.food}/></View><Text style={styles.foodSearchStateTitle}>Sin coincidencias</Text><Text style={styles.foodSearchStateCopy}>Probá con otro plato, categoría o restaurante.</Text><Pressable style={styles.foodSearchRetry} onPress={()=>setFoodQuery("")}><Text style={styles.foodSearchRetryText}>Limpiar búsqueda</Text></Pressable></View>:null}
                {catalogResults.map((result) => (
                  <Pressable
                    key={result.restaurantId}
                    onPress={() => {
                      setSelectedRestaurantId(result.restaurantId);
                      setFoodScreen("restaurant");
                    }}
                    style={styles.foodSearchResultCard}
                  >
                    <ImageBackground
                      source={{ uri: result.cover }}
                      imageStyle={styles.foodCardBannerImage}
                      style={styles.foodSearchResultImage}
                    ><View style={styles.foodSearchResultEta}><Ionicons name="time-outline" size={12} color={flashDesign.color.ink}/><Text style={styles.foodSearchResultEtaText}>{result.etaMin} min</Text></View></ImageBackground>
                    <View style={styles.foodSearchResultBody}>
                      <View style={styles.foodSearchResultHeading}><Text style={styles.foodSearchResultName} numberOfLines={1}>{result.restaurantName}</Text><Ionicons name="chevron-forward" size={18} color={flashDesign.color.muted}/></View>
                      <Text style={styles.foodSearchResultCuisine} numberOfLines={1}>{result.cuisine}</Text>
                      <View style={styles.foodSearchResultMeta}><Ionicons name="bicycle-outline" size={14} color={flashDesign.color.inkSoft}/><Text style={styles.foodSearchResultMetaText}>{result.deliveryFee?money.format(result.deliveryFee):"Envío gratis"}</Text><View style={styles.foodMetaDot}/><Text style={styles.foodSearchResultMetaText}>{result.matchCount} {result.matchCount===1?"coincidencia":"coincidencias"}</Text></View>
                      {result.matchedItems.length?<Text style={styles.searchMatchText} numberOfLines={1}>{result.matchedItems.map(item=>item.name).join(" · ")}</Text>:null}
                    </View>
                  </Pressable>
                ))}
                {catalogNextOffset!==null&&!catalogSearchLoading&&<Pressable style={styles.searchMoreButton} onPress={()=>{setCatalogSearchLoading(true);void api.searchCatalog(foodQuery,catalogNextOffset).then(result=>{setCatalogResults(current=>[...current,...result.results]);setCatalogNextOffset(result.nextOffset);}).catch(error=>setCatalogSearchError(error instanceof Error?error.message:"No se pudo continuar")).finally(()=>setCatalogSearchLoading(false));}}><Text style={styles.searchMoreText}>Ver más resultados</Text></Pressable>}
              </>
            )}

            {foodScreen === "restaurant" && selectedRestaurant && (
              <>
                <ImageBackground
                  source={{ uri: selectedRestaurant.cover }}
                  imageStyle={styles.foodRestaurantHeroImage}
                  style={styles.foodRestaurantHero}
                >
                  <Pressable
                    onPress={() => setFoodScreen("home")}
                    style={styles.foodFloatingButton}
                  >
                    <Ionicons name="chevron-back" size={22} color={flashDesign.color.ink} />
                  </Pressable>
                  <Pressable disabled={favoritePendingId===selectedRestaurant.id} style={styles.foodFloatingButton} accessibilityLabel={favoriteRestaurantIds.includes(selectedRestaurant.id)?`Quitar ${selectedRestaurant.name} de favoritos`:`Guardar ${selectedRestaurant.name} en favoritos`} accessibilityState={{checked:favoriteRestaurantIds.includes(selectedRestaurant.id),busy:favoritePendingId===selectedRestaurant.id}} onPress={()=>void toggleFavorite(selectedRestaurant.id)}>
                    <Ionicons name={favoriteRestaurantIds.includes(selectedRestaurant.id)?"heart":"heart-outline"} size={22} color={favoriteRestaurantIds.includes(selectedRestaurant.id)?flashDesign.color.food:flashDesign.color.ink} />
                  </Pressable>
                </ImageBackground>
                <View style={styles.foodRestaurantInfo}>
                  <View style={styles.foodRestaurantStatusRow}><View style={styles.foodRestaurantOpenBadge}><View style={styles.foodRestaurantOpenDot}/><Text style={styles.foodRestaurantOpenText}>Abierto ahora</Text></View>{selectedRestaurant.badge?<Text style={styles.foodRestaurantOfferBadge}>{selectedRestaurant.badge}</Text>:null}</View>
                  <Text style={styles.foodRestaurantTitle}>{selectedRestaurant.name}</Text>
                  <Text style={styles.foodRestaurantCuisine}>{selectedRestaurant.cuisine} · {selectedRestaurant.address}</Text>
                  <View style={styles.foodRestaurantFacts}>
                    <View style={styles.foodRestaurantFact}><View style={styles.foodRestaurantFactIcon}><Ionicons name="star" size={15} color="#E98A00"/></View><View><Text style={styles.foodRestaurantFactValue}>{selectedRestaurant.rating.toFixed(1)}</Text><Text style={styles.foodRestaurantFactLabel}>calificación</Text></View></View>
                    <View style={styles.foodRestaurantFact}><View style={styles.foodRestaurantFactIcon}><Ionicons name="time-outline" size={16} color={flashDesign.color.food}/></View><View><Text style={styles.foodRestaurantFactValue}>{selectedRestaurant.etaMin} min</Text><Text style={styles.foodRestaurantFactLabel}>estimado</Text></View></View>
                    <View style={styles.foodRestaurantFact}><View style={styles.foodRestaurantFactIcon}><Ionicons name="bicycle-outline" size={16} color={flashDesign.color.shipment}/></View><View><Text style={styles.foodRestaurantFactValue}>{selectedRestaurant.deliveryFee?money.format(selectedRestaurant.deliveryFee):"Gratis"}</Text><Text style={styles.foodRestaurantFactLabel}>{selectedRestaurant.distanceKm.toFixed(1)} km</Text></View></View>
                  </View>
                </View>
                <View style={styles.foodSectionHeader}><Text style={styles.foodSectionTitle}>Menú</Text><Text style={styles.foodSeeAll}>{visibleFoodMenuItems.length} disponibles</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.foodMenuTabs}>
                  {foodMenuCategories.map(category=><Pressable key={category} style={[styles.foodMenuTabButton,foodMenuCategory===category&&styles.foodMenuTabButtonActive]} onPress={()=>setFoodMenuCategory(category)} accessibilityState={{selected:foodMenuCategory===category}}><Text style={[styles.foodMenuTab,foodMenuCategory===category&&styles.foodMenuTabActive]}>{category}</Text></Pressable>)}
                </ScrollView>
                {dietaryPreferences.hideIncompatible&&<View style={styles.dietaryFilterBanner}><Ionicons name="options-outline" size={17} color="#087a50"/><Text style={styles.dietaryBadgeText}>Filtro personal activo · sólo productos declarados compatibles</Text></View>}
                {visibleFoodMenuItems.map((item) => (
                  <View key={item.id} style={styles.foodProductCard}>
                    <ImageBackground
                      source={{ uri: selectedRestaurant.image||selectedRestaurant.cover }}
                      imageStyle={styles.foodProductImageStyle}
                      style={styles.foodProductImage}
                    >{!item.stock?<View style={styles.foodProductUnavailable}><Text style={styles.foodProductUnavailableText}>AGOTADO</Text></View>:null}</ImageBackground>
                    <View style={styles.itemCopy}>
                      <View style={styles.foodProductHeading}><Text style={styles.foodProductName} numberOfLines={2}>{item.name}</Text>{item.dietaryLabels?.length?<Ionicons name="leaf-outline" size={16} color={flashDesign.color.shipment}/>:null}</View>
                      <Text style={styles.foodProductDescription} numberOfLines={2}>{item.description?.trim()||item.category||"Información del producto no declarada"}</Text>
                      <Text style={styles.foodProductPrice}>
                        {money.format(item.price)}
                      </Text>
                    </View>
                    <Pressable
                      disabled={!item.stock || busy}
                      onPress={() => {if(item.modifierGroups?.length){setCustomizingRestaurant(selectedRestaurant);setCustomizingItem(item);setCustomizingExtras([]);setCustomizingNote("");}else addItem(selectedRestaurant,item);}}
                      style={[styles.foodAddButton,!item.stock&&styles.foodAddButtonDisabled]}
                      accessibilityLabel={item.stock?`Agregar ${item.name}`:`${item.name} agotado`}
                    >
                      <Ionicons name="add" size={22} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {visibleFoodMenuItems.length===0?<View style={styles.foodSearchState}><View style={styles.foodSearchStateIcon}><Ionicons name="restaurant-outline" size={25} color={flashDesign.color.food}/></View><Text style={styles.foodSearchStateTitle}>No hay productos disponibles</Text><Text style={styles.foodSearchStateCopy}>Probá otra categoría o revisá tus preferencias alimentarias.</Text><Pressable style={styles.foodSearchRetry} onPress={()=>setFoodMenuCategory("Todos")}><Text style={styles.foodSearchRetryText}>Ver todo el menú</Text></Pressable></View>:null}
                {cart.length > 0 && (
                  <Pressable
                    onPress={() => setFoodScreen("cart")}
                    style={styles.foodStickyCart}
                  >
                    <Text style={styles.foodStickyCount}>
                      {cart.reduce((sum, line) => sum + line.quantity, 0)}
                    </Text>
                    <Text style={styles.foodStickyLabel}>Ver carrito</Text>
                    <Text style={styles.foodStickyPrice}>
                      {money.format(cartTotal)}
                    </Text>
                  </Pressable>
                )}
                <Modal visible={Boolean(customizingItem&&customizingRestaurant)} transparent animationType="slide" onRequestClose={()=>setCustomizingItem(null)}><View style={styles.productCustomizerBackdrop}><View style={styles.productCustomizerSheet}><View style={styles.addressBookHeading}><View><Text style={styles.foodRestaurantTitle}>{customizingItem?.name}</Text><Text style={styles.cardText}>Personalizá tu pedido</Text></View><Pressable style={styles.foodBack} onPress={()=>setCustomizingItem(null)}><Ionicons name="close" size={21} color="#222"/></Pressable></View><ScrollView contentContainerStyle={styles.productCustomizerContent}>{Boolean(customizingItem?.dietaryLabels?.length)&&<View style={styles.dietaryBadgeRow}>{customizingItem?.dietaryLabels?.map(label=><View style={styles.dietaryBadge} key={label.code}><Ionicons name="leaf-outline" size={14} color="#087a50"/><Text style={styles.dietaryBadgeText}>{label.name}</Text></View>)}</View>}{Boolean(customizingItem?.allergens?.length)&&<View style={styles.allergenWarning}><Ionicons name="warning-outline" size={20} color="#9a4b00"/><View><Text style={styles.allergenWarningTitle}>Información de alérgenos</Text><Text style={styles.allergenWarningText}>{customizingItem?.allergens?.map(entry=>`${entry.presence==="contains"?"Contiene":"Puede contener"} ${entry.name.toLowerCase()}`).join(" · ")}</Text></View></View>}{customizingItem?.modifierGroups?.map(group=>{const selected=customizingExtras.filter(id=>group.modifiers.some(modifier=>modifier.id===id));return <View key={group.id} style={styles.foodCard}><View style={styles.addressBookHeading}><View><Text style={styles.sectionTitle}>{group.name}</Text><Text style={styles.cardText}>{group.required?"Obligatorio":"Opcional"} · elegí {group.min}–{group.max}</Text></View><Text style={styles.modifierCounter}>{selected.length}/{group.max}</Text></View>{group.modifiers.filter(modifier=>modifier.available).map(modifier=>{const checked=customizingExtras.includes(modifier.id);return <Pressable key={modifier.id} style={styles.modifierRow} onPress={()=>setCustomizingExtras(current=>checked?current.filter(id=>id!==modifier.id):selected.length>=group.max?current:[...current,modifier.id])}><Ionicons name={checked?"checkmark-circle":"ellipse-outline"} size={22} color={checked?"#ff6a21":"#aaa"}/><Text style={[styles.sectionTitle,{flex:1}]}>{modifier.name}</Text><Text style={styles.foodProductPrice}>{modifier.price?`+ ${money.format(modifier.price)}`:"Incluido"}</Text></Pressable>})}</View>})}<Text style={styles.foodSectionTitle}>Indicaciones para cocina</Text><TextInput value={customizingNote} onChangeText={setCustomizingNote} maxLength={500} multiline placeholder="Ej. sin sal, cortar por la mitad" style={[styles.input,styles.productNote]}/></ScrollView><ActionButton label="Agregar al carrito" disabled={busy||Boolean(customizingItem?.modifierGroups?.some(group=>customizingExtras.filter(id=>group.modifiers.some(modifier=>modifier.id===id)).length<group.min))} onPress={()=>{if(customizingRestaurant&&customizingItem)addItem(customizingRestaurant,customizingItem,customizingExtras,customizingNote);setCustomizingItem(null);}}/></View></View></Modal>
              </>
            )}

            {foodScreen === "cart" && (
              <>
                <View style={styles.foodPageHeader}>
                  <Pressable
                    onPress={() =>
                      setFoodScreen(selectedRestaurant ? "restaurant" : "home")
                    }
                    style={styles.foodBack}
                  >
                    <Ionicons name="chevron-back" size={20} color="#222" />
                  </Pressable>
                  <Text style={styles.foodPageTitle}>Mi carrito</Text>
                </View>
                {cart.length === 0 ? (
                  <View style={styles.foodEmpty}>
                    <Ionicons
                      name="bag-handle-outline"
                      size={58}
                      color="#ff6a21"
                    />
                    <Text style={styles.foodSectionTitle}>
                      Tu carrito está vacío
                    </Text>
                    <ActionButton
                      label="Explorar restaurantes"
                      disabled={busy}
                      onPress={() => setFoodScreen("home")}
                    />
                  </View>
                ) : (
                  <>
                    <Text style={styles.foodSectionTitle}>
                      {cartRestaurant?.name}
                    </Text>
                    {cart.map((line) => (
                      <View key={line.lineId} style={styles.foodCartLine}>
                        <View style={styles.itemCopy}>
                          <Text style={styles.itemName}>{line.name}</Text>
                          <Text style={styles.foodProductPrice}>
                            {money.format(line.unitPrice * line.quantity)}
                          </Text>
                          {line.extras.length>0&&<Text style={styles.cardText}>{line.extras.length} agregado{line.extras.length===1?"":"s"}</Text>}
                          {line.note&&<Text style={styles.cardText}>“{line.note}”</Text>}
                        </View>
                        <View style={styles.foodQuantity}>
                          <Pressable
                            onPress={() =>
                              changeCartQuantity(line.lineId, -1)
                            }
                          >
                            <Ionicons name="remove" size={20} color="#ff6a21" />
                          </Pressable>
                          <Text style={styles.itemName}>{line.quantity}</Text>
                          <Pressable
                            onPress={() =>
                              changeCartQuantity(line.lineId, 1)
                            }
                          >
                            <Ionicons name="add" size={20} color="#ff6a21" />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    <Text style={styles.foodSectionTitle}>
                      Dirección de entrega
                    </Text>
                    {state.addresses.filter(item=>item.userId===user.id&&!item.id.startsWith("profile-")&&item.lat!==null&&item.lng!==null).map(address=><Pressable key={address.id} onPress={()=>{setDeliveryAddress(address.address);setFoodCheckoutQuote(null);}} style={[styles.paymentMethodRow,deliveryAddress===address.address&&styles.notificationUnread]}><View style={styles.savedAddressIcon}><Ionicons name={address.isDefault?"home":"location-outline"} size={18} color="#ff6a21"/></View><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>{address.label}</Text><Text style={styles.cardText}>{address.address}</Text></View>{deliveryAddress===address.address?<Ionicons name="checkmark-circle" size={22} color="#ff6a21"/>:null}</Pressable>)}
                    <Text style={styles.foodSectionTitle}>Método de pago</Text>
                    {customerPaymentMethods.map(method=><Pressable key={method.id} onPress={()=>{setSelectedFoodPaymentId(method.id);setFoodCheckoutQuote(null);}} style={[styles.paymentMethodRow,selectedFoodPayment?.id===method.id&&styles.notificationUnread]}><View style={styles.savedAddressIcon}><Ionicons name={method.type==="wallet"?"wallet":"card"} size={18} color="#7c3cff"/></View><Text style={[styles.sectionTitle,{flex:1}]}>{method.label}</Text>{selectedFoodPayment?.id===method.id?<Ionicons name="checkmark-circle" size={22} color="#7c3cff"/>:null}</Pressable>)}
                    <Text style={styles.foodSectionTitle}>Cupón</Text>
                    <TextInput value={foodPromotionCode} onChangeText={value=>{setFoodPromotionCode(value.toUpperCase());setFoodCheckoutQuote(null);}} autoCapitalize="characters" placeholder="Código promocional (opcional)" style={styles.input}/>
                    <View style={styles.foodTotalRow}>
                      <Text style={styles.cardTitle}>Total productos</Text>
                      <Text style={styles.foodRestaurantTitle}>
                        {money.format(cartTotal)}
                      </Text>
                    </View>
                    <ActionButton
                      label="Continuar al checkout"
                      disabled={busy||!selectedFoodAddress||!selectedFoodPayment}
                      onPress={openFoodCheckout}
                    />
                  </>
                )}
              </>
            )}

            {foodScreen === "checkout" && foodCheckoutQuote && (
              <>
                <View style={styles.foodPageHeader}><Pressable onPress={()=>setFoodScreen("cart")} style={styles.foodBack}><Ionicons name="chevron-back" size={20} color="#222"/></Pressable><Text style={styles.foodPageTitle}>Confirmar pedido</Text></View>
                <View style={styles.foodCard}><View style={styles.addressBookHeading}><View><Text style={styles.foodRestaurantTitle}>{cartRestaurant?.name}</Text><Text style={styles.cardText}>Llega en aproximadamente {foodCheckoutQuote.etaMin} min</Text></View><View style={styles.savedAddressIcon}><Ionicons name="shield-checkmark" size={20} color="#087a50"/></View></View><Text style={styles.cardText}>{foodCheckoutQuote.distanceKm} km · precio bloqueado por 5 minutos</Text><Text style={styles.helperText}>{foodCheckoutQuote.pricingVersion}</Text></View>
                <Text style={styles.foodSectionTitle}>Entrega</Text>
                <View style={styles.paymentMethodRow}><Ionicons name="location" size={20} color="#ff6a21"/><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>En {foodCheckoutQuote.deliveryAddress}</Text><Text style={styles.cardText}>Dirección validada con coordenadas reales</Text></View></View>
                <Text style={styles.foodSectionTitle}>Pago</Text>
                <View style={styles.paymentMethodRow}><Ionicons name={selectedFoodPayment?.type==="wallet"?"wallet":"card"} size={20} color="#7c3cff"/><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>{foodCheckoutQuote.paymentMethod}</Text><Text style={styles.cardText}>{selectedFoodPayment?.type==="wallet"?"Captura atómica al confirmar":"Token seguro · captura según proveedor"}</Text></View></View>
                <Text style={styles.foodSectionTitle}>Resumen</Text>
                {foodCheckoutQuote.items.map((item,index)=><View key={`${item.menuItemId}-${index}`} style={styles.checkoutItem}><View style={styles.foodTotalRow}><Text style={styles.cardText}>{item.quantity} × {item.name}</Text><Text style={styles.sectionTitle}>{money.format(item.unitPrice*item.quantity)}</Text></View>{item.modifiers.map(modifier=><Text key={modifier.id} style={styles.helperText}>+ {modifier.name}{modifier.price?` · ${money.format(modifier.price)}`:""}</Text>)}{item.note?<Text style={styles.helperText}>Nota: {item.note}</Text>:null}</View>)}
                <View style={styles.foodCard}><View style={styles.foodTotalRow}><Text style={styles.cardText}>Productos</Text><Text style={styles.sectionTitle}>{money.format(foodCheckoutQuote.subtotal)}</Text></View><View style={styles.foodTotalRow}><Text style={styles.cardText}>Envío</Text><Text style={styles.sectionTitle}>{money.format(foodCheckoutQuote.deliveryFee)}</Text></View><View style={styles.foodTotalRow}><Text style={styles.cardText}>Tarifa de servicio</Text><Text style={styles.sectionTitle}>{money.format(foodCheckoutQuote.serviceFee)}</Text></View>{foodCheckoutQuote.discount>0?<View style={styles.foodTotalRow}><Text style={[styles.cardText,{color:"#087a50"}]}>Descuento {foodCheckoutQuote.promotionCode}</Text><Text style={[styles.sectionTitle,{color:"#087a50"}]}>− {money.format(foodCheckoutQuote.discount)}</Text></View>:null}<View style={styles.foodTotalRow}><Text style={styles.foodRestaurantTitle}>Total</Text><Text style={styles.foodRestaurantTitle}>{money.format(foodCheckoutQuote.total)}</Text></View></View>
                <View style={styles.issueSecurityNote}><Ionicons name="lock-closed" size={18} color="#087a50"/><Text style={styles.issueSecurityText}>El servidor volverá a validar stock, cupón, propiedad de la dirección y monto firmado antes de cobrar.</Text></View>
                <ActionButton label="Confirmar y pedir" disabled={busy||new Date(foodCheckoutQuote.expiresAt)<=new Date()} onPress={createOrder}/>
                {new Date(foodCheckoutQuote.expiresAt)<=new Date()?<ActionButton label="Actualizar precio" disabled={busy} onPress={openFoodCheckout}/>:null}
              </>
            )}

            {foodScreen === "orders" && (
              <>
                {lastCreatedOrder&&<View style={styles.orderConfirmationCard}><View style={styles.orderConfirmationIcon}><Ionicons name="checkmark" size={30} color="#fff"/></View><Text style={styles.orderConfirmationEyebrow}>PEDIDO CONFIRMADO</Text><Text style={styles.foodRestaurantTitle}>El comercio ya lo recibió</Text><Text style={styles.cardText}>Pedido {lastCreatedOrder.id} · entrega estimada en {lastCreatedOrder.etaMin} min.</Text><Text style={styles.totalText}>{money.format(lastCreatedOrder.total)}</Text><Pressable style={styles.orderConfirmationAction} onPress={()=>{setLastCreatedOrder(null);setSharedView("activity");}}><Text style={styles.orderConfirmationActionText}>Seguir en Actividad</Text><Ionicons name="arrow-forward" size={18} color="#fff"/></Pressable></View>}
                <Text style={styles.foodRestaurantTitle}>Tus pedidos</Text>
                {activeOrders.length === 0 && (
                  <View style={styles.foodEmpty}>
                    <Ionicons
                      name="receipt-outline"
                      size={54}
                      color="#ff6a21"
                    />
                    <Text style={styles.cardText}>
                      No hay pedidos en curso.
                    </Text>
                  </View>
                )}
                {activeOrders.map((order) => (
                  <View key={order.id} style={styles.foodCard}>
                    <Text style={styles.cardTitle}>{order.status}</Text>
                    <Text style={styles.cardText}>
                      {order.deliveryAddress} · {money.format(order.total)}
                    </Text>
                    <Pressable
                      style={styles.shareAction}
                      onPress={() =>
                        shareStatus(
                          "Pedido Flash",
                          `Mi pedido Flash está ${order.status}. Entrega en ${order.deliveryAddress}.`,
                        )
                      }
                    >
                      <Ionicons
                        name="share-social-outline"
                        size={18}
                        color="#ff6a21"
                      />
                      <Text style={styles.shareActionText}>
                        Compartir estado
                      </Text>
                    </Pressable>
                    <Pressable style={styles.reorderButton} onPress={()=>setTrackingOrderId(order.id)}><Ionicons name="map-outline" size={18} color="#fff"/><Text style={styles.reorderButtonText}>Ver seguimiento</Text></Pressable>
                    <ActionButton
                      label="Cancelar pedido"
                      disabled={busy}
                      onPress={() => cancelService("order", order.id)}
                    />
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {sharedView === "service" && customerWindow === "ride" && (
          <>
            <View style={styles.rideHeading}>
              <View>
                <Text style={styles.rideEyebrow}>VIAJES</Text>
                <Text style={styles.rideTitle}>¿A dónde vamos?</Text>
              </View>
              <View style={styles.livePill}>
                <Text style={styles.livePillText}>
                  {state.metrics.onlineDrivers} online
                </Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickPlacesRail}
            >
              {rideQuickPlaces.map(place => (
                <Pressable
                  key={place.id}
                  onPress={() => {
                    setDestination(place.address);
                    setDestinationCoords(place.point);
                    setRoadRoute(null);
                    setRideQuote(null);
                    setRideOptions([]);
                  }}
                  style={styles.quickPlace}
                >
                  <View style={styles.quickPlaceIcon}>
                    <Ionicons name={place.icon as never} size={18} color="#7c3cff" />
                  </View>
                  <View style={styles.quickPlaceCopy}>
                    <Text style={styles.quickPlaceTitle}>{place.label}</Text>
                    <Text style={styles.quickPlaceAddress} numberOfLines={1}>
                      {place.address}
                    </Text>
                  </View>
                  {place.recentId&&<Pressable hitSlop={8} disabled={busy} onPress={event=>{event.stopPropagation();runAction(async()=>{const result=await api.deleteRideDestination(place.recentId!);setRideDestinations(result.destinations);},"Destino reciente eliminado");}}><Ionicons name="close-circle" size={18} color="#a89ead"/></Pressable>}
                </Pressable>
              ))}
              {rideQuickPlaces.length===0&&<View style={styles.quickPlaceEmpty}><Ionicons name="time-outline" size={18} color="#7c3cff"/><Text style={styles.quickPlaceAddress}>Tus destinos recientes aparecerán acá.</Text></View>}
            </ScrollView>
            {pickupCoords && destinationCoords ? (
              <FlashNativeMap
                origin={pickupCoords}
                destination={destinationCoords}
                route={roadRoute?.coordinates || []}
                caption={roadRoute ? `Ruta real · ${roadRoute.distanceKm} km · ${roadRoute.durationMin} min` : "Origen y destino confirmados"}
                detail={roadRoute ? "Arrastrá para explorar · tocá el control para reencuadrar" : "Cotizá para calcular el recorrido vial"}
                routeColor="#7c3cff"
                height={210}
                accessibilityLabel="Mapa interactivo de la cotización del viaje"
              />
            ) : (
              <NativeMapUnavailable
                height={210}
                message={!pickupCoords ? "Usá GPS o elegí un origen para comenzar." : "Elegí un destino para mostrar el recorrido."}
              />
            )}
            {roadRoute?.steps.length ? (
              <View style={styles.navigationCard}>
                <View style={styles.navigationTurn}>
                  <Ionicons
                    name={
                      roadRoute.steps[activeRoadStep]?.modifier.includes("left")
                        ? "arrow-back"
                        : roadRoute.steps[activeRoadStep]?.modifier.includes(
                              "right",
                            )
                          ? "arrow-forward"
                          : "arrow-up"
                    }
                    size={26}
                    color="#fff"
                  />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.navigationLabel}>
                    GUÍA DE RUTA · PASO {activeRoadStep + 1}/
                    {roadRoute.steps.length}
                  </Text>
                  <Text style={styles.navigationInstruction}>
                    {navigationInstruction(roadRoute.steps[activeRoadStep])}
                  </Text>
                  <Text style={styles.helperText}>
                    En{" "}
                    {roadRoute.steps[activeRoadStep].distanceM < 1000
                      ? `${roadRoute.steps[activeRoadStep].distanceM} m`
                      : `${(roadRoute.steps[activeRoadStep].distanceM / 1000).toFixed(1)} km`}
                  </Text>
                </View>
                <Pressable
                  disabled={activeRoadStep >= roadRoute.steps.length - 1}
                  onPress={() =>
                    setActiveRoadStep((step) =>
                      Math.min(step + 1, roadRoute.steps.length - 1),
                    )
                  }
                  style={styles.navigationNext}
                >
                  <Ionicons name="chevron-forward" size={20} color="#7c3cff" />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.rideSheet}>
              <TextInput
                value={pickup}
                onChangeText={(value) => {
                  setPickup(value);
                  setPickupCoords(null);
                }}
                placeholder="Origen"
                style={styles.input}
              />
              <Pressable
                onPress={useCurrentLocation}
                style={styles.secondaryAction}
              >
                <Text style={styles.secondaryActionText}>
                  Usar mi ubicacion actual
                </Text>
              </Pressable>
              <TextInput
                value={destination}
                onChangeText={(value) => {
                  setDestination(value);
                  setDestinationCoords(null);
                  setRoadRoute(null);
                  setRideQuote(null);
                  setRideOptions([]);
                }}
                placeholder="Destino"
                style={styles.input}
              />
              {locationMessage ? (
                <Text style={styles.helperText}>{locationMessage}</Text>
              ) : null}
              {rideOptions.map((option) => (
                <Pressable
                  key={option.service}
                  disabled={!option.available}
                  onPress={() => {
                    setRideService(option.service);
                    setRideQuote(option);
                  }}
                  style={[
                    styles.rideOption,
                    rideService === option.service && styles.rideOptionActive,
                    !option.available && styles.actionDisabled,
                  ]}
                >
                  <View style={styles.vehicleBadge}>
                    <Ionicons
                      name={option.service === "moto" ? "bicycle" : "car-sport"}
                      size={24}
                      color="#fff"
                    />
                  </View>
                  <View style={styles.rideOptionCopy}>
                    <Text style={styles.rideOptionTitle}>{option.label}</Text>
                    <Text style={styles.helperText}>
                      {option.description} · {option.capacity} pasajeros
                    </Text>
                    <Text style={styles.helperText}>
                      {option.available
                        ? `${option.pickupEtaMin} min · ${option.availableDrivers} conductores`
                        : "Sin conductores disponibles"}
                    </Text>
                  </View>
                  <Text style={styles.ridePrice}>
                    {money.format(option.fare)}
                  </Text>
                </Pressable>
              ))}
              {rideQuote && (
                <Text style={styles.routeSummary}>
                  {rideQuote.distanceKm} km · {rideQuote.durationMin} min
                </Text>
              )}
              {rideQuote?.breakdown && (
                <View style={styles.fareBreakdown}>
                  <View style={styles.fareBreakdownHeader}>
                    <View>
                      <Text style={styles.rideOptionTitle}>
                        Precio adelantado
                      </Text>
                      <Text style={styles.helperText}>
                        Bloqueado por 5 minutos · {rideQuote.pricingVersion}
                      </Text>
                    </View>
                    <Text style={styles.fareTotal}>
                      {money.format(rideQuote.fare)}
                    </Text>
                  </View>
                  <View style={styles.fareLine}>
                    <Text style={styles.cardText}>Base</Text>
                    <Text style={styles.cardText}>
                      {money.format(rideQuote.breakdown.baseFare)}
                    </Text>
                  </View>
                  <View style={styles.fareLine}>
                    <Text style={styles.cardText}>
                      Distancia y tiempo estimados
                    </Text>
                    <Text style={styles.cardText}>
                      {money.format(
                        rideQuote.breakdown.distanceFare +
                          rideQuote.breakdown.timeFare,
                      )}
                    </Text>
                  </View>
                  <View style={styles.fareLine}>
                    <Text style={styles.cardText}>Tarifa de servicio</Text>
                    <Text style={styles.cardText}>
                      {money.format(rideQuote.breakdown.serviceFee)}
                    </Text>
                  </View>
                  {rideQuote.breakdown.demandAdjustment > 0 && (
                    <View style={styles.fareLine}>
                      <Text style={styles.demandText}>
                        Demanda actual ×
                        {rideQuote.breakdown.demandMultiplier.toFixed(2)}
                      </Text>
                      <Text style={styles.demandText}>
                        {money.format(rideQuote.breakdown.demandAdjustment)}
                      </Text>
                    </View>
                  )}
                  {rideQuote.breakdown.tolls > 0 && (
                    <View style={styles.fareLine}>
                      <Text style={styles.cardText}>Peajes estimados</Text>
                      <Text style={styles.cardText}>
                        {money.format(rideQuote.breakdown.tolls)}
                      </Text>
                    </View>
                  )}
                </View>
              )}
              <Text style={styles.rideOptionTitle}>¿Cuándo viajás?</Text>
              <View style={styles.choiceRow}>
                {(
                  [
                    ["now", "Ahora"],
                    ["hour", "En 1 hora"],
                    ["tomorrow", "Mañana"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setRideSchedule(value)}
                    style={[
                      styles.choice,
                      rideSchedule === value && styles.choiceActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceText,
                        rideSchedule === value && styles.choiceTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.actionRow}>
                <ActionButton
                  label="Cotizar"
                  disabled={busy}
                  onPress={quoteRide}
                />
                <ActionButton
                  label="Solicitar"
                  disabled={busy || !rideQuote}
                  onPress={requestRide}
                />
              </View>
            </View>
            <View style={styles.safetyStrip}>
              <View style={styles.safetyIcon}>
                <Ionicons name="shield-checkmark" size={21} color="#087a4b" />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.safetyTitle}>
                  Tu seguridad, visible siempre
                </Text>
                <Text style={styles.helperText}>
                  Viaje identificado, ubicación compartible y soporte desde la
                  actividad.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color="#8a858e" />
            </View>
            <View style={styles.newAddressForm}>
              <View style={styles.addressBookHeading}><View><Text style={styles.rideOptionTitle}>Contactos de confianza</Text><Text style={styles.helperText}>Hasta 5 personas. El teléfono queda cifrado y sólo se usa para ayudarte a compartir.</Text></View><Ionicons name="people-circle-outline" size={28} color="#7c3cff"/></View>
              {rideTrustedContacts.map(contact=><View key={contact.id} style={styles.quickPlace}><View style={styles.quickPlaceIcon}><Ionicons name="person" size={18} color="#7c3cff"/></View><View style={styles.quickPlaceCopy}><Text style={styles.quickPlaceTitle}>{contact.name}</Text><Text style={styles.quickPlaceAddress}>{contact.relationship} · •••• {contact.last4}</Text></View><Pressable disabled={busy} onPress={()=>runAction(async()=>{const result=await api.deleteRideTrustedContact(contact.id);setRideTrustedContacts(result.contacts);},"Contacto eliminado")}><Ionicons name="close-circle-outline" size={22} color="#9a939d"/></Pressable></View>)}
              {rideTrustedContacts.length<5&&<><TextInput style={styles.input} value={trustedContactName} onChangeText={setTrustedContactName} placeholder="Nombre del contacto"/><TextInput style={styles.input} value={trustedContactPhone} onChangeText={value=>setTrustedContactPhone(value.replace(/[^+0-9]/g,""))} keyboardType="phone-pad" placeholder="+5491112345678"/><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{([['family','Familia'],['friend','Amistad'],['partner','Pareja'],['coworker','Trabajo'],['other','Otro']] as const).map(([value,label])=><Pressable key={value} style={[styles.issueCategoryPill,trustedContactRelationship===value&&styles.issueCategoryPillActive]} onPress={()=>setTrustedContactRelationship(value)}><Text style={[styles.issueCategoryText,trustedContactRelationship===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView><Pressable disabled={busy||trustedContactName.trim().length<2||!/^\+[1-9][0-9]{7,14}$/.test(trustedContactPhone)} style={[styles.primaryButton,(busy||trustedContactName.trim().length<2||!/^\+[1-9][0-9]{7,14}$/.test(trustedContactPhone))&&styles.disabledButton]} onPress={()=>runAction(async()=>{const result=await api.createRideTrustedContact({name:trustedContactName.trim(),phone:trustedContactPhone,relationship:trustedContactRelationship});setRideTrustedContacts(result.contacts);setTrustedContactName("");setTrustedContactPhone("");},"Contacto protegido y guardado")}><Ionicons name="shield-checkmark-outline" size={18} color="#fff"/><Text style={styles.primaryButtonText}>Guardar contacto seguro</Text></Pressable></>}
            </View>
            <Text style={styles.sectionTitle}>Viajes en curso</Text>
            {activeRides.map((ride) => (
              <View key={ride.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {ride.scheduledFor ? "Viaje reservado" : ride.status}
                </Text>
                {ride.scheduledFor ? (
                  <Text style={styles.totalText}>
                    {new Date(ride.scheduledFor).toLocaleString("es-AR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </Text>
                ) : null}
                <Text style={styles.cardText}>
                  {ride.pickup} → {ride.destination}
                </Text>
                <Text style={styles.totalText}>{money.format(ride.fare)}</Text>
                <Pressable style={styles.orderConfirmationAction} disabled={Boolean(ride.scheduledFor)} onPress={()=>setTrackingRideId(ride.id)}><Ionicons name="navigate-outline" size={18} color="#fff"/><Text style={styles.orderConfirmationActionText}>{ride.scheduledFor?"Seguimiento disponible al iniciar":"Abrir viaje en vivo"}</Text></Pressable>
                <Pressable
                  style={styles.shareAction}
                  disabled={busy || Boolean(ride.scheduledFor)}
                  onPress={() => shareRideLive(ride)}
                >
                  <Ionicons
                    name="share-social-outline"
                    size={18}
                    color="#7c3cff"
                  />
                  <Text style={[styles.shareActionText, { color: "#7c3cff" }]}>
                    Compartir seguimiento en vivo
                  </Text>
                </Pressable>
                {rideTrustedContacts.length>0&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{rideTrustedContacts.map(contact=><Pressable key={contact.id} style={styles.issueCategoryPill} disabled={busy||Boolean(ride.scheduledFor)} onPress={()=>shareRideLive(ride,contact)}><Ionicons name="person-outline" size={15} color="#7c3cff"/><Text style={styles.issueCategoryText}>Enviar a {contact.name}</Text></Pressable>)}</ScrollView>}
                {!ride.scheduledFor && (
                  <Pressable
                    style={[styles.shareAction, { backgroundColor: "#fff0f0" }]}
                    disabled={busy}
                    onPress={() => confirmRideSos(ride)}
                  >
                    <Ionicons name="shield-checkmark" size={18} color="#c92626" />
                    <Text style={[styles.shareActionText, { color: "#c92626" }]}>Seguridad · SOS</Text>
                  </Pressable>
                )}
                <ActionButton
                  label="Cancelar viaje"
                  disabled={busy}
                  onPress={() => cancelService("ride", ride.id)}
                />
              </View>
            ))}
          </>
        )}

        {sharedView === "service" && customerWindow === "shipment" && (
          <>
            <View style={styles.shipmentHero}>
              <Text style={styles.rideEyebrow}>FLASH ENVIOS</Text>
              <Text style={styles.rideTitle}>Mandá algo hoy</Text>
              <Text style={styles.shipmentHeroCopy}>
                Entrega local en el día con seguimiento y PIN.
              </Text>
              <View style={styles.shipmentBenefits}>
                <Text style={styles.shipmentBenefit}>✓ Cotización previa</Text>
                <Text style={styles.shipmentBenefit}>✓ PIN de entrega</Text>
              </View>
            </View>
            {shipmentPickupCoords&&shipmentDestinationCoords?<FlashNativeMap origin={shipmentPickupCoords} destination={shipmentDestinationCoords} route={shipmentRoadRoute?.coordinates||[]} caption={shipmentRoadRoute?`${shipmentRoadRoute.distanceKm} km · ${shipmentRoadRoute.durationMin} min de recorrido`:"Retiro y entrega confirmados"} detail={shipmentQuote?"Cotización vigente · recorrido real":"Cotizá para validar cobertura y recorrido"} routeColor="#087a50" driverIcon="bicycle" height={210} accessibilityLabel="Mapa interactivo de la cotización del envío"/>:<NativeMapUnavailable height={210} message="Ingresá direcciones y cotizá para validar el recorrido real."/>}
            <View style={styles.rideSheet}>
              <TextInput
                value={shipmentPickup}
                onChangeText={(value) => {
                  setShipmentPickup(value);
                  setShipmentQuote(null);
                  setShipmentPickupCoords(null);
                  setShipmentRoadRoute(null);
                }}
                placeholder="Retirar en"
                style={styles.input}
              />
              <TextInput
                value={shipmentDestination}
                onChangeText={(value) => {
                  setShipmentDestination(value);
                  setShipmentQuote(null);
                  setShipmentDestinationCoords(null);
                  setShipmentRoadRoute(null);
                }}
                placeholder="Entregar en"
                style={styles.input}
              />
              <View style={styles.choiceRow}>
                {(["small", "medium", "large"] as const).map((size) => (
                  <Pressable
                    key={size}
                    onPress={() => {
                      setPackageSize(size);
                      setShipmentQuote(null);
                    }}
                    style={[
                      styles.choice,
                      packageSize === size && styles.choiceActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceText,
                        packageSize === size && styles.choiceTextActive,
                      ]}
                    >
                      {size === "small"
                        ? "Chico"
                        : size === "medium"
                          ? "Mediano"
                          : "Grande"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={packageWeight}
                onChangeText={(value) => {
                  setPackageWeight(value);
                  setShipmentQuote(null);
                }}
                placeholder="Peso en kg (max. 20)"
                keyboardType="numeric"
                style={styles.input}
              />
              <Text style={styles.foodSectionTitle}>Qué enviás</Text>
              {!shipmentOptions&&!shipmentOptionsError?<ActivityIndicator color="#7c3cff"/>:null}{shipmentOptionsError?<Text style={styles.errorText}>{shipmentOptionsError}</Text>:null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shipmentOptionRail}>{(shipmentOptions?.categories||[]).map(category=><Pressable key={category.code} onPress={()=>{setShipmentItemCategory(category.code);setShipmentQuote(null);}} style={[styles.shipmentOptionCard,shipmentItemCategory===category.code&&styles.shipmentOptionCardActive]}><Ionicons name={category.code==="documents"?"document-text":category.code==="fragile"?"wine":category.code==="electronics"?"phone-portrait":"cube"} size={20} color={shipmentItemCategory===category.code?"#fff":"#7c3cff"}/><Text style={shipmentItemCategory===category.code?styles.shipmentOptionTextActive:styles.shipmentOptionText}>{category.name}</Text><Text style={shipmentItemCategory===category.code?styles.shipmentOptionMetaActive:styles.shipmentOptionMeta}>hasta {category.maximumWeightKg} kg{category.surcharge?` · +${money.format(category.surcharge)}`:""}</Text></Pressable>)}</ScrollView>
              <Text style={styles.foodSectionTitle}>Velocidad</Text>
              <View style={styles.shipmentSlaGrid}>{(shipmentOptions?.serviceLevels||[]).map(level=><Pressable key={level.code} onPress={()=>{setShipmentServiceLevel(level.code);setShipmentQuote(null);}} style={[styles.shipmentSlaCard,shipmentServiceLevel===level.code&&styles.shipmentSlaCardActive]}><Text style={shipmentServiceLevel===level.code?styles.shipmentSlaTitleActive:styles.shipmentSlaTitle}>{level.name}</Text><Text style={shipmentServiceLevel===level.code?styles.shipmentSlaCaptionActive:styles.shipmentSlaCaption}>ETA ×{level.etaMultiplier}{level.maximumDistanceKm?` · hasta ${level.maximumDistanceKm} km`:""}</Text></Pressable>)}</View>
              <TextInput value={declaredValue} onChangeText={value=>{setDeclaredValue(value.replace(/[^0-9]/g,""));setShipmentQuote(null);}} placeholder="Valor declarado (ARS)" keyboardType="numeric" style={styles.input}/>
              <Pressable style={[styles.shipmentProtectionCard,shipmentProtection==="standard"&&styles.shipmentProtectionCardActive]} onPress={()=>{setShipmentProtection(current=>current==="standard"?"none":"standard");setShipmentQuote(null);}}><View style={styles.shipmentProtectionIcon}><Ionicons name="shield-checkmark" size={21} color="#fff"/></View><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>Protección Flash</Text><Text style={styles.cardText}>Prima calculada por servidor sobre el valor declarado.</Text></View><Ionicons name={shipmentProtection==="standard"?"checkmark-circle":"ellipse-outline"} size={23} color={shipmentProtection==="standard"?"#087a50":"#aaa"}/></Pressable>
              <Pressable style={[styles.shipmentProtectionCard,shipmentSignatureRequired&&styles.shipmentProtectionCardActive]} onPress={()=>{setShipmentSignatureRequired(current=>!current);setShipmentQuote(null);}}><View style={[styles.shipmentProtectionIcon,{backgroundColor:"#17131c"}]}><Ionicons name="pencil" size={20} color="#fff"/></View><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>Exigir firma al entregar</Text><Text style={styles.cardText}>El conductor no podrá completar sin foto, firma e identidad del receptor.</Text></View><Ionicons name={shipmentSignatureRequired?"checkmark-circle":"ellipse-outline"} size={23} color={shipmentSignatureRequired?"#087a50":"#aaa"}/></Pressable>
              <TextInput
                value={packageDescription}
                onChangeText={setPackageDescription}
                placeholder="Contenido general (sin datos sensibles)"
                style={styles.input}
              />
              <TextInput
                value={recipientName}
                onChangeText={setRecipientName}
                placeholder="Nombre del destinatario"
                style={styles.input}
              />
              <TextInput
                value={recipientPhone}
                onChangeText={setRecipientPhone}
                placeholder="Telefono del destinatario"
                keyboardType="phone-pad"
                style={styles.input}
              />
              <Text style={styles.helperText}>
                Debe estar cerrado, pesar hasta 20 kg y no contener dinero,
                armas, sustancias, medicamentos ni productos peligrosos.
              </Text>
              {shipmentQuote && (
                <View style={styles.quoteBox}>
                  <Text style={styles.cardTitle}>
                    {money.format(shipmentQuote.fare)}
                  </Text>
                  <Text style={styles.cardText}>
                    {shipmentQuote.distanceKm} km · llega en{" "}
                    {shipmentQuote.etaMin} min
                  </Text>
                  <Text style={styles.protectionQuoteText}>{shipmentQuote.serviceLevelName} · {shipmentQuote.itemCategoryName}</Text>
                  {shipmentQuote.handlingInstructions?<Text style={styles.helperText}>{shipmentQuote.handlingInstructions}</Text>:null}
                  {shipmentQuote.protection==="standard"&&<Text style={styles.protectionQuoteText}>Protección {money.format(shipmentQuote.protectionPremium||0)} · valor {money.format(shipmentQuote.declaredValue||0)} · franquicia {money.format(shipmentQuote.deductible||0)}</Text>}
                </View>
              )}
              <View style={styles.actionRow}>
                <ActionButton
                  label="Cotizar"
                  disabled={busy}
                  onPress={quoteShipment}
                />
                <ActionButton
                  label="Solicitar envio"
                  disabled={busy || !shipmentQuote}
                  onPress={createShipment}
                />
              </View>
            </View>
            <Text style={styles.sectionTitle}>Envios en curso</Text>
            {activeShipments.map((shipment) => (
              <View key={shipment.id} style={styles.card}>
                <Text style={styles.cardTitle}>{shipment.status}</Text>
                <Text style={styles.cardText}>
                  {shipment.pickup} → {shipment.destination}
                </Text>
                <Text style={styles.cardText}>
                  Destinatario: {shipment.recipientName}
                </Text>
                {shipmentCodes[shipment.id] ? (
                  <Text style={styles.foodRestaurantTitle}>
                    PIN {shipmentCodes[shipment.id]}
                  </Text>
                ) : (
                  <ActionButton
                    label="Ver PIN de entrega"
                    disabled={busy}
                    onPress={() =>
                      runAction(async () => {
                        const response = await api.getShipmentDeliveryCode(
                          shipment.id,
                        );
                        setShipmentCodes((current) => ({
                          ...current,
                          [shipment.id]: response.deliveryCode,
                        }));
                      }, "PIN disponible")
                    }
                  />
                )}
                <Text style={styles.totalText}>
                  {money.format(shipment.fare)}
                </Text>
                <Pressable
                  style={styles.shareAction}
                  onPress={() =>
                    shareStatus(
                      "Envío Flash",
                      `Seguimiento ${shipment.id}: ${shipment.status}. Destino ${shipment.destination}.`,
                    )
                  }
                >
                  <Ionicons
                    name="share-social-outline"
                    size={18}
                    color="#7c3cff"
                  />
                  <Text style={[styles.shareActionText, { color: "#7c3cff" }]}>
                    Compartir seguimiento
                  </Text>
                </Pressable>
                <ActionButton
                  label="Cancelar envio"
                  disabled={busy}
                  onPress={() => cancelService("shipment", shipment.id)}
                />
              </View>
            ))}
          </>
        )}
        {sharedView === "activity" && (
          <>
            <View style={styles.activityHeading}>
              <Text style={styles.foodRestaurantTitle}>Actividad</Text>
              <Text style={styles.cardText}>
                Pedidos, viajes y envíos en un solo lugar.
              </Text>
            </View>
            {activeOrders.length +
              activeRides.length +
              activeShipments.length ===
              0 &&
              pendingSubstitutions.length === 0 &&
              completedForTips.length === 0 &&
              recentCancellations.length === 0 && (
                <View style={styles.foodEmpty}>
                  <Ionicons name="time-outline" size={56} color="#7c3cff" />
                  <Text style={styles.foodSectionTitle}>
                    Todavía no hay actividad
                  </Text>
                </View>
              )}
            {pendingSubstitutions.length>0&&<><View style={styles.substitutionSectionTitle}><View><Text style={styles.foodSectionTitle}>Necesitan tu decisión</Text><Text style={styles.cardText}>El comercio no puede avanzar hasta que respondas.</Text></View><View style={styles.substitutionCount}><Text style={styles.substitutionCountText}>{pendingSubstitutions.length}</Text></View></View>{pendingSubstitutions.map(substitution=>{const difference=Math.max(0,(substitution.original.unitPrice-substitution.replacement.unitPrice)*substitution.quantity);return <View key={substitution.id} style={styles.substitutionCard}><View style={styles.substitutionAlert}><Ionicons name="swap-horizontal" size={22} color="#fff"/></View><View style={styles.substitutionContent}><Text style={styles.substitutionEyebrow}>Sustitución propuesta</Text><Text style={styles.substitutionTitle}>{substitution.original.name}</Text><View style={styles.substitutionArrowRow}><View style={styles.substitutionProduct}><Text style={styles.cardText}>Original</Text><Text style={styles.substitutionPrice}>{money.format(substitution.original.unitPrice)}</Text></View><Ionicons name="arrow-forward" size={20} color="#7c3cff"/><View style={styles.substitutionProduct}><Text style={styles.cardText}>{substitution.replacement.name}</Text><Text style={styles.substitutionPrice}>{money.format(substitution.replacement.unitPrice)}</Text></View></View><Text style={styles.substitutionReason}>{substitution.reason}</Text>{difference>0&&<View style={styles.substitutionRefund}><Ionicons name="wallet-outline" size={17} color="#087a50"/><Text style={styles.substitutionRefundText}>Recibís {money.format(difference)} en Flash Wallet</Text></View>}<View style={styles.substitutionActions}><Pressable disabled={busy} style={[styles.substitutionReject,busy&&styles.disabledButton]} onPress={()=>runAction(async()=>{const result=await api.decideOrderSubstitution(substitution.id,"rejected");setOrderSubstitutions(current=>current.map(entry=>entry.id===result.substitution.id?result.substitution:entry));},"Sustitución rechazada") }><Text style={styles.substitutionRejectText}>Rechazar</Text></Pressable><Pressable disabled={busy} style={[styles.substitutionAccept,busy&&styles.disabledButton]} onPress={()=>runAction(async()=>{const result=await api.decideOrderSubstitution(substitution.id,"accepted");setOrderSubstitutions(current=>current.map(entry=>entry.id===result.substitution.id?result.substitution:entry));},"Sustitución aceptada y diferencia reintegrada")}><Ionicons name="checkmark-circle" size={18} color="#fff"/><Text style={styles.substitutionAcceptText}>Aceptar cambio</Text></Pressable></View></View></View>})}</>}
            {activeOrders.map((order) => (
              <View key={order.id} style={styles.stack}><Pressable style={styles.activityCard} onPress={()=>setTrackingOrderId(order.id)}>
                <View style={styles.activityIconFood}>
                  <Ionicons name="fast-food" size={21} color="#fff" />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.cardTitle}>Pedido · {order.status}</Text>
                  <Text style={styles.cardText}>{order.deliveryAddress}</Text>
                  <Text style={styles.totalText}>
                    {money.format(order.total)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#aaa"/>
              </Pressable><Pressable style={styles.shareAction} onPress={()=>setChatJobId(order.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat con comercio y repartidor</Text></Pressable></View>
            ))}
            {activeRides.map((ride) => (
              <View key={ride.id} style={styles.stack}><Pressable style={styles.activityCard} onPress={()=>setTrackingRideId(ride.id)}>
                <View style={styles.activityIconRide}>
                  <Ionicons name="car-sport" size={21} color="#fff" />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.cardTitle}>Viaje · {ride.status}</Text>
                  <Text style={styles.cardText}>
                    {ride.pickup} → {ride.destination}
                  </Text>
                  <Text style={styles.totalText}>
                    {money.format(ride.fare)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#aaa"/>
              </Pressable><Pressable style={styles.shareAction} onPress={()=>setChatJobId(ride.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat con el conductor</Text></Pressable></View>
            ))}
            {activeShipments.map((shipment) => (
              <View key={shipment.id} style={styles.stack}><Pressable style={styles.activityCard} onPress={()=>setTrackingShipmentId(shipment.id)}>
                <View style={styles.activityIconRide}>
                  <Ionicons name="cube" size={21} color="#fff" />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.cardTitle}>
                    Envío · {shipment.status}
                  </Text>
                  <Text style={styles.cardText}>
                    {shipment.pickup} → {shipment.destination}
                  </Text>
                  <Text style={styles.totalText}>
                    {money.format(shipment.fare)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#aaa"/>
              </Pressable><Pressable style={styles.shareAction} onPress={()=>setChatJobId(shipment.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat con el conductor</Text></Pressable></View>
            ))}
            {recentCancellations.length > 0 && (
              <>
                <Text style={styles.foodSectionTitle}>Cancelaciones</Text>
                {recentCancellations.map((cancellation) => (
                  <View key={cancellation.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{cancellation.label}</Text>
                    <Text style={styles.cardText}>
                      Motivo: {cancellation.reason.replaceAll("_", " ")}
                    </Text>
                    <Text style={styles.totalText}>
                      Reintegro · {money.format(cancellation.refundAmount)}
                    </Text>
                    <Text style={styles.cardText}>
                      {new Date(cancellation.createdAt).toLocaleString("es-AR")}
                    </Text>
                  </View>
                ))}
              </>
            )}
            {completedForTips.length > 0 ? (
              <>
                <Text style={styles.foodSectionTitle}>
                  Servicios completados
                </Text>
                {completedForTips.map((service) => {
                  const existingTip = (state.tips || []).find(
                      (tip) => tip.jobId === service.id,
                    ),
                    receipt = receipts[service.id],
                    suggested = Math.max(
                      100,
                      Math.min(
                        Math.floor(service.amount * 0.5),
                        Math.max(
                          500,
                          Math.round((service.amount * 0.1) / 100) * 100,
                        ),
                      ),
                    );
                  return (
                    <View key={service.id} style={styles.card}>
                      <Text style={styles.cardTitle}>{service.label}</Text>
                      {receipt ? (
                        <View>
                          <Text style={styles.totalText}>
                            {receipt.number} · {money.format(receipt.total)}
                          </Text>
                          <Text style={styles.cardText}>
                            {new Date(receipt.issuedAt).toLocaleString("es-AR")}{" "}
                            · Comprobante de servicio no fiscal
                          </Text>
                          {receipt.lineItems.map((line, index) => (
                            <Text
                              key={`${receipt.id}-${index}`}
                              style={styles.cardText}
                            >
                              {line.quantity}× {line.name} ·{" "}
                              {money.format(line.total)}
                            </Text>
                          ))}
                        </View>
                      ) : (
                        <ActionButton
                          label="Ver comprobante"
                          disabled={busy}
                          onPress={() =>
                            runAction(async () => {
                              const response = await api.getReceipt(service.id);
                              setReceipts((current) => ({
                                ...current,
                                [service.id]: response.receipt,
                              }));
                            }, "Comprobante cargado")
                          }
                        />
                      )}
                      {service.kind==="order"&&<><Pressable style={styles.reorderButton} disabled={busy} onPress={()=>runAction(async()=>{const result=await api.reorder(service.id);setCart(result.cart.map(line=>({lineId:`${line.item.id}:${line.extras.slice().sort().join(",")}:${line.note}`,restaurantId:line.restaurantId,menuItemId:line.item.id,name:line.item.name,unitPrice:line.item.price,quantity:line.quantity,extras:line.extras,note:line.note})));setCartHydrated(true);setCustomerWindow("food");setSharedView("service");setFoodScreen("cart");},"Carrito reconstruido con precios y stock actuales")}><Ionicons name="refresh-outline" size={18} color="#fff"/><Text style={styles.reorderButtonText}>Pedir de nuevo</Text></Pressable><Pressable style={styles.reportIssueButton} disabled={busy} onPress={()=>{setIssueOrderId(service.id);setIssueCategory("missing_item");setIssueDescription("");setIssueRefund("");}}><Ionicons name="alert-circle-outline" size={18} color="#d14b32"/><Text style={styles.reportIssueText}>Reportar un problema con el pedido</Text><Ionicons name="chevron-forward" size={17} color="#a29aa5"/></Pressable></>}
                      {service.kind==="shipment"&&(shipmentReturns.find(entry=>entry.shipmentId===service.id)?<View style={styles.returnStatusCard}><Ionicons name="return-down-back" size={18} color="#7c3cff"/><Text style={styles.cardText}>Devolución · {shipmentReturns.find(entry=>entry.shipmentId===service.id)?.status.replaceAll("_"," ")}</Text></View>:<Pressable style={styles.reportIssueButton} disabled={busy} onPress={()=>{setReturnShipmentId(service.id);setReturnReason("");}}><Ionicons name="return-down-back" size={18} color="#7c3cff"/><Text style={styles.reportIssueText}>Solicitar devolución</Text><Ionicons name="chevron-forward" size={17} color="#a29aa5"/></Pressable>)}
                      {service.kind==="shipment"&&state.shipments.find(entry=>entry.id===service.id)?.protection==="standard"&&(()=>{const claim=shipmentClaims.find(entry=>entry.shipmentId===service.id);return claim?<View style={styles.returnStatusCard}><Ionicons name="shield-checkmark" size={18} color="#087a50"/><View style={{flex:1,gap:6}}><Text style={styles.cardText}>Siniestro · {claim.status.replaceAll("_"," ")} · elegible {money.format(claim.eligibleAmount)}</Text>{claim.evidence?.map(item=><Pressable key={item.id} onPress={()=>runAction(()=>openClaimEvidence(item.id),"Evidencia abierta")}><Text style={styles.reportIssueText}>📎 {item.fileName} · {Math.ceil(item.sizeBytes/1024)} KB</Text></Pressable>)}{["submitted","under_review"].includes(claim.status)&&<Pressable disabled={busy} onPress={()=>runAction(()=>attachClaimEvidence(claim.id),"Evidencia cifrada y adjuntada")}><Text style={styles.reportIssueText}>+ Adjuntar foto o PDF</Text></Pressable>}</View></View>:<Pressable style={styles.reportIssueButton} disabled={busy} onPress={()=>{const shipment=state.shipments.find(entry=>entry.id===service.id);setClaimShipmentId(service.id);setClaimType("damaged");setClaimDescription("");setClaimAmount(String(shipment?.declaredValue||0));}}><Ionicons name="shield-outline" size={18} color="#087a50"/><Text style={styles.reportIssueText}>Reportar siniestro protegido</Text><Ionicons name="chevron-forward" size={17} color="#a29aa5"/></Pressable>;})()}
                      <Text style={styles.foodSectionTitle}>Propina</Text>
                      {existingTip ? (
                        <Text style={styles.totalText}>
                          Enviada · {money.format(existingTip.amount)}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.cardText}>
                            Va completa a la Wallet del conductor.
                          </Text>
                          <View style={styles.actionRow}>
                            <ActionButton
                              label={money.format(suggested)}
                              disabled={busy}
                              onPress={() =>
                                runAction(
                                  () => api.createTip(service.id, suggested),
                                  "Propina enviada",
                                )
                              }
                            />
                            <ActionButton
                              label={money.format(
                                Math.min(
                                  Math.floor(service.amount * 0.5),
                                  suggested * 2,
                                ),
                              )}
                              disabled={busy}
                              onPress={() =>
                                runAction(
                                  () =>
                                    api.createTip(
                                      service.id,
                                      Math.min(
                                        Math.floor(service.amount * 0.5),
                                        suggested * 2,
                                      ),
                                    ),
                                  "Propina enviada",
                                )
                              }
                            />
                          </View>
                        </>
                      )}
                    </View>
                  );
                })}
              </>
            ) : null}
            {activityCursor?<Pressable disabled={activityLoading} style={[styles.secondaryButton,activityLoading&&styles.disabledButton]} onPress={()=>void loadActivity(true)}><Text style={styles.secondaryButtonText}>{activityLoading?"Cargando…":"Ver actividad anterior"}</Text></Pressable>:null}
          </>
        )}
        {sharedView === "account" && (
          <>
            <View style={styles.customerAccountHeading}>
              <View style={styles.itemCopy}>
                <Text style={styles.foodRestaurantTitle}>Tu cuenta</Text>
                <Text style={styles.cardText}>
                  Datos utilizados por todos los servicios Flash.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cerrar sesión"
                disabled={busy}
                onPress={() => void onLogout()}
                style={({ pressed }) => [
                  styles.customerLogoutButton,
                  (pressed || busy) && styles.disabledButton,
                ]}
              >
                <Ionicons name="log-out-outline" size={18} color="#27242a" />
                <Text style={styles.customerLogoutText}>Salir</Text>
              </Pressable>
            </View>
            <View style={styles.accountCard}>
              <View style={styles.accountAvatar}>
                <Text style={styles.accountInitial}>
                  {user.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.foodRestaurantTitle}>{user.name}</Text>
              <Text style={styles.cardText}>{user.email}</Text>
              <View style={styles.accountDetail}>
                <Ionicons name="location-outline" size={20} color="#7c3cff" />
                <Text style={styles.cardText}>
                  {user.defaultAddress || "Sin dirección guardada"}
                </Text>
              </View>
              <View style={styles.accountDetail}>
                <Ionicons name="wallet-outline" size={20} color="#7c3cff" />
                <Text style={styles.totalText}>
                  Wallet {money.format(user.wallet)}
                </Text>
              </View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View style={styles.savedAddressCopy}><Text style={styles.foodRestaurantTitle}>Teléfono de seguridad</Text><Text style={styles.cardText}>{user.phone||"Agregá un teléfono internacional desde tu perfil."}</Text></View><Ionicons name={phoneVerified?"checkmark-circle":"shield-outline"} size={28} color={phoneVerified?"#087a50":"#7c3cff"}/></View>
              {phoneVerified?<View style={styles.dietarySafetyNote}><Ionicons name="checkmark-circle-outline" size={19} color="#087a50"/><Text style={styles.cardText}>Número verificado. Si lo cambiás, Flash solicitará una verificación nueva.</Text></View>:user.phone?<><Text style={styles.cardText}>Confirmá que tenés acceso a este número. El código vence en 10 minutos y admite cinco intentos.</Text><TextInput value={phoneVerificationCode} onChangeText={value=>setPhoneVerificationCode(value.replace(/\D/g,"").slice(0,6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} placeholder="Código de 6 dígitos" style={styles.input}/><Pressable disabled={busy||phoneVerificationCode.length!==6} style={[styles.primaryButton,(busy||phoneVerificationCode.length!==6)&&styles.disabledButton]} onPress={()=>runAction(async()=>{await api.confirmPhoneVerification(phoneVerificationCode);setPhoneVerified(true);setPhoneVerificationCode("");},"Teléfono verificado")}><Ionicons name="shield-checkmark-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>Verificar teléfono</Text></Pressable><Pressable disabled={busy||phoneRetrySeconds>0} style={[styles.secondaryButton,(busy||phoneRetrySeconds>0)&&styles.disabledButton]} onPress={()=>runAction(async()=>{const result=await api.requestPhoneVerification();setPhoneVerificationCode(result.developmentCode||"");setPhoneRetrySeconds(result.retryAfterSeconds);},"Código solicitado")}><Ionicons name="chatbubble-ellipses-outline" size={18} color="#7c3cff"/><Text style={styles.secondaryButtonText}>{phoneRetrySeconds>0?`Reenviar en ${phoneRetrySeconds}s`:"Enviar código por SMS"}</Text></Pressable></>:null}
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View style={styles.savedAddressCopy}><Text style={styles.foodRestaurantTitle}>Dispositivos y sesiones</Text><Text style={styles.cardText}>Cerrá accesos que no reconozcas. Flash nunca muestra tus credenciales.</Text></View><Ionicons name="shield-checkmark-outline" size={26} color="#087a50"/></View>
              {accountSessions.length?accountSessions.map(session=><View key={session.id} style={styles.notificationRow}><View style={styles.notificationBell}><Ionicons name="phone-portrait-outline" size={20} color="#fff"/></View><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>{session.deviceName}</Text><Text style={styles.notificationTime}>Iniciada {new Date(session.createdAt).toLocaleString("es-AR")} · vence {new Date(session.expiresAt).toLocaleDateString("es-AR")}</Text></View><Pressable disabled={busy} accessibilityLabel={`Cerrar sesión ${session.deviceName}`} onPress={()=>Alert.alert("Cerrar sesión",`¿Cerrar el acceso de ${session.deviceName}?`,[{text:"Cancelar",style:"cancel"},{text:"Cerrar",style:"destructive",onPress:()=>runAction(async()=>{await api.revokeAccountSession(session.id);setAccountSessions(current=>current.filter(item=>item.id!==session.id));},"Sesión cerrada")}])}><Ionicons name="log-out-outline" size={21} color="#c43b36"/></Pressable></View>):<Text style={styles.cardText}>No hay otras sesiones activas para mostrar.</Text>}
              {accountSessions.length>1?<Pressable disabled={busy} style={styles.secondaryButton} onPress={()=>Alert.alert("Proteger cuenta","Se cerrarán todas las sesiones excepto la de este dispositivo.",[{text:"Cancelar",style:"cancel"},{text:"Cerrar las demás",style:"destructive",onPress:()=>runAction(async()=>{await api.revokeOtherAccountSessions();const result=await api.getAccountSessions();setAccountSessions(result.sessions);},"Las demás sesiones fueron cerradas")}])}><Ionicons name="lock-closed-outline" size={18} color="#7c3cff"/><Text style={styles.secondaryButtonText}>Cerrar las demás sesiones</Text></Pressable>:null}
            </View>
            {referral&&<View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View style={styles.savedAddressCopy}><Text style={styles.foodRestaurantTitle}>Invitá y ganá</Text><Text style={styles.cardText}>{referral.campaign?`Vos recibís ${money.format(referral.campaign.advocateReward)} y tu amistad ${money.format(referral.campaign.friendReward)} después de su primer servicio pagado.`:"No hay una campaña activa ahora."}</Text></View><Ionicons name="gift-outline" size={27} color="#7c3cff"/></View>
              <View style={styles.shipmentPinCard}><Text style={styles.orderConfirmationEyebrow}>TU CÓDIGO</Text><Text style={styles.referralCode}>{referral.code}</Text><Text style={styles.helperText}>{referral.invited} invitaciones · {referral.rewarded} recompensadas</Text></View>
              <Pressable disabled={!referral.campaign} style={[styles.primaryButton,!referral.campaign&&styles.disabledButton]} onPress={()=>Share.share({message:`Sumate a Flash con mi código ${referral.code}. La recompensa se acredita después de tu primer servicio pagado.`})}><Ionicons name="share-social-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>Compartir invitación</Text></Pressable>
              {referral.attribution?<View style={styles.dietarySafetyNote}><Ionicons name={referral.attribution.status==="rewarded"?"checkmark-circle-outline":"time-outline"} size={18} color="#087a50"/><Text style={styles.cardText}>{referral.attribution.status==="rewarded"?"Tu recompensa de referido ya fue acreditada en Wallet.":"Código aplicado. Se acredita al completar tu primer servicio pagado."}</Text></View>:<View style={styles.newAddressForm}><Text style={styles.sectionTitle}>¿Te invitó alguien?</Text><TextInput value={referralClaim} onChangeText={value=>setReferralClaim(value.toUpperCase())} autoCapitalize="characters" maxLength={13} placeholder="FLASHXXXXXXXX" style={styles.input}/><Pressable disabled={busy||!/^FLASH[A-Z0-9]{8}$/.test(referralClaim)} style={[styles.primaryButton,(busy||!/^FLASH[A-Z0-9]{8}$/.test(referralClaim))&&styles.disabledButton]} onPress={()=>runAction(async()=>{const result=await api.claimReferral(referralClaim);setReferral(result.referral);setReferralClaim("");},"Código aplicado; la recompensa queda pendiente del primer servicio")}><Ionicons name="ticket-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>Aplicar código</Text></Pressable></View>}
            </View>}
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View><Text style={styles.foodRestaurantTitle}>Preferencias alimentarias</Text><Text style={styles.cardText}>Se guardan en tu cuenta y ayudan a ocultar incompatibles.</Text></View><Ionicons name="leaf-outline" size={25} color="#087a50"/></View>
              <Text style={styles.sectionTitle}>Mi alimentación</Text><View style={styles.dietaryPreferenceGrid}>{[{code:"vegetarian",name:"Vegetariano"},{code:"vegan",name:"Vegano"},{code:"gluten_free",name:"Sin gluten"},{code:"halal",name:"Halal"},{code:"kosher",name:"Kosher"}].map(option=>{const selected=dietaryPreferences.dietaryLabels.some(entry=>entry.code===option.code);return <Pressable key={option.code} style={[styles.dietaryPreferenceChip,selected&&styles.dietaryPreferenceChipActive]} onPress={()=>{const dietaryLabels=selected?dietaryPreferences.dietaryLabels.filter(entry=>entry.code!==option.code).map(entry=>entry.code):[...dietaryPreferences.dietaryLabels.map(entry=>entry.code),option.code];runAction(async()=>{const result=await api.updateDietaryPreferences({dietaryLabels,avoidedAllergens:dietaryPreferences.avoidedAllergens.map(entry=>entry.code),hideIncompatible:dietaryPreferences.hideIncompatible});setDietaryPreferences(result.preferences);},"Preferencias alimentarias actualizadas");}}><Text style={[styles.dietaryPreferenceText,selected&&styles.dietaryPreferenceTextActive]}>{option.name}</Text></Pressable>})}</View>
              <Text style={styles.sectionTitle}>Evito estos alérgenos</Text><View style={styles.dietaryPreferenceGrid}>{[{code:"gluten",name:"Gluten"},{code:"milk",name:"Leche"},{code:"eggs",name:"Huevo"},{code:"peanuts",name:"Maní"},{code:"tree_nuts",name:"Frutos secos"},{code:"soy",name:"Soja"},{code:"fish",name:"Pescado"},{code:"shellfish",name:"Crustáceos"},{code:"sesame",name:"Sésamo"}].map(option=>{const selected=dietaryPreferences.avoidedAllergens.some(entry=>entry.code===option.code);return <Pressable key={option.code} style={[styles.dietaryPreferenceChip,selected&&styles.dietaryAllergenChipActive]} onPress={()=>{const avoidedAllergens=selected?dietaryPreferences.avoidedAllergens.filter(entry=>entry.code!==option.code).map(entry=>entry.code):[...dietaryPreferences.avoidedAllergens.map(entry=>entry.code),option.code];runAction(async()=>{const result=await api.updateDietaryPreferences({dietaryLabels:dietaryPreferences.dietaryLabels.map(entry=>entry.code),avoidedAllergens,hideIncompatible:dietaryPreferences.hideIncompatible});setDietaryPreferences(result.preferences);},"Alérgenos actualizados");}}><Text style={[styles.dietaryPreferenceText,selected&&styles.dietaryAllergenTextActive]}>{option.name}</Text></Pressable>})}</View>
              <View style={styles.preferenceRow}><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>Ocultar productos incompatibles</Text><Text style={styles.cardText}>Sólo usa declaraciones del comercio; “sin datos” nunca significa seguro.</Text></View><Pressable disabled={busy} accessibilityRole="switch" accessibilityState={{checked:dietaryPreferences.hideIncompatible}} style={[styles.preferenceSwitch,dietaryPreferences.hideIncompatible&&styles.preferenceSwitchActive]} onPress={()=>runAction(async()=>{const result=await api.updateDietaryPreferences({dietaryLabels:dietaryPreferences.dietaryLabels.map(entry=>entry.code),avoidedAllergens:dietaryPreferences.avoidedAllergens.map(entry=>entry.code),hideIncompatible:!dietaryPreferences.hideIncompatible});setDietaryPreferences(result.preferences);},"Filtro alimentario actualizado")}><View style={[styles.preferenceKnob,dietaryPreferences.hideIncompatible&&styles.preferenceKnobActive]}/></Pressable></View>
              <View style={styles.dietarySafetyNote}><Ionicons name="information-circle-outline" size={18} color="#9a4b00"/><Text style={styles.allergenWarningText}>Ante una alergia severa, confirmá siempre con el comercio. Las indicaciones de cocina no eliminan contaminación cruzada.</Text></View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View><Text style={styles.foodRestaurantTitle}>Notificaciones</Text><Text style={styles.cardText}>{notifications.filter(item=>!item.readAt).length} sin leer · historial persistente</Text></View><View style={styles.notificationBell}><Ionicons name="notifications-outline" size={22} color="#fff"/></View></View>
              {notifications.slice(0,8).map(item=>{const titles:Record<string,string>={order_status:"Actualización del pedido",ride_status:"Actualización del viaje",shipment_status:"Actualización del envío",order_substitution:"El comercio propone un cambio",order_issue_resolved:"Incidencia resuelta",tip_received:"Recibiste una propina",support_reply:"Nueva respuesta de soporte",support_ticket_created:"Caso de soporte creado"};return <Pressable key={item.id} disabled={Boolean(item.readAt)||busy} onPress={()=>runAction(async()=>{const result=await api.markNotificationRead(item.id);setNotifications(result.notifications);},"Notificación leída")} style={[styles.notificationRow,!item.readAt&&styles.notificationUnread]}><View style={styles.notificationStatusDot}/><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>{titles[item.template]||"Novedad de Flash"}</Text><Text style={styles.cardText}>{String(item.payload.status||item.payload.kind||"Revisá la actividad de tu cuenta")}</Text><Text style={styles.notificationTime}>{new Date(item.createdAt).toLocaleString("es-AR")}</Text></View>{!item.readAt&&<Text style={styles.notificationNew}>NUEVA</Text>}</Pressable>})}
              {!notifications.length&&<View style={styles.notificationEmpty}><Ionicons name="checkmark-circle-outline" size={27} color="#087a50"/><Text style={styles.cardText}>Estás al día. Las novedades reales aparecerán acá.</Text></View>}
              <View style={styles.preferenceGroup}><Text style={styles.sectionTitle}>Preferencias push</Text>{notificationPreferences.map(preference=>{const labels={service_updates:"Servicios",promotions:"Promociones",support:"Soporte",wallet:"Wallet",account:"Cuenta"};return <View style={styles.preferenceRow} key={preference.category}><View><Text style={styles.sectionTitle}>{labels[preference.category]}</Text><Text style={styles.cardText}>{preference.pushEnabled?"Push activado":"Sólo dentro de la app"}</Text></View><Pressable disabled={busy} accessibilityRole="switch" accessibilityState={{checked:preference.pushEnabled}} style={[styles.preferenceSwitch,preference.pushEnabled&&styles.preferenceSwitchActive]} onPress={()=>runAction(async()=>{const result=await api.updateNotificationPreference(preference.category,{pushEnabled:!preference.pushEnabled,emailEnabled:preference.emailEnabled});setNotificationPreferences(result.preferences);},"Preferencia actualizada")}><View style={[styles.preferenceKnob,preference.pushEnabled&&styles.preferenceKnobActive]}/></Pressable></View>})}</View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View><Text style={styles.foodRestaurantTitle}>Ayuda y soporte</Text><Text style={styles.cardText}>Casos reales con seguimiento y SLA.</Text></View><Ionicons name="headset-outline" size={25} color="#7c3cff"/></View>
              {state.supportTickets.filter(ticket=>ticket.userId===user.id).map(ticket=><View style={styles.supportTicketCard} key={ticket.id}><View style={styles.supportTicketHeader}><View style={styles.savedAddressCopy}><Text style={styles.sectionTitle}>{ticket.title}</Text><Text style={styles.cardText}>{ticket.id} · {ticket.status.replaceAll("_"," ")}</Text></View><Text style={[styles.supportSla,ticket.slaStatus.includes("breached")&&styles.supportSlaLate]}>{ticket.slaStatus==="on_track"?"EN SLA":ticket.slaStatus==="met"?"RESUELTO":"DEMORADO"}</Text></View><Text style={styles.notificationTime}>Respuesta antes de {new Date(ticket.firstResponseDueAt).toLocaleString("es-AR")}</Text><View style={styles.supportMessages}>{ticket.messages.map(message=><View key={message.id} style={[styles.supportMessage,message.senderId===user.id?styles.supportMessageOwn:styles.supportMessageStaff]}><Text style={[styles.supportMessageText,message.senderId===user.id&&styles.supportMessageTextOwn]}>{message.body}</Text><Text style={[styles.supportMessageTime,message.senderId===user.id&&styles.supportMessageTextOwn]}>{new Date(message.createdAt).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</Text></View>)}</View>{!["resolved","closed"].includes(ticket.status)&&<View style={styles.supportReplyRow}><TextInput style={[styles.input,styles.supportReplyInput]} value={supportReplies[ticket.id]||""} onChangeText={value=>setSupportReplies(current=>({...current,[ticket.id]:value}))} placeholder="Escribí una respuesta"/><Pressable disabled={busy||(supportReplies[ticket.id]||"").trim().length<1} style={[styles.supportSendButton,(busy||(supportReplies[ticket.id]||"").trim().length<1)&&styles.disabledButton]} onPress={()=>runAction(async()=>{await api.sendSupportMessage(ticket.id,(supportReplies[ticket.id]||"").trim());setSupportReplies(current=>({...current,[ticket.id]:""}));},"Respuesta enviada")}><Ionicons name="send" size={18} color="#fff"/></Pressable></View>}</View>)}
              <View style={styles.newAddressForm}><Text style={styles.sectionTitle}>Abrir un caso</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{([["food","Comida"],["ride","Viaje"],["shipment","Envío"],["payment","Pago"],["account","Cuenta"],["safety","Seguridad"],["other","Otro"]] as const).map(([value,label])=><Pressable key={value} style={[styles.issueCategoryPill,supportCategory===value&&styles.issueCategoryPillActive]} onPress={()=>setSupportCategory(value)}><Text style={[styles.issueCategoryText,supportCategory===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView><TextInput style={styles.input} value={supportSubject} onChangeText={setSupportSubject} placeholder="Resumen del problema"/><TextInput multiline numberOfLines={4} style={[styles.input,styles.issueDescriptionInput]} value={supportBody} onChangeText={setSupportBody} placeholder="Contanos qué pasó con el mayor detalle posible"/><Pressable disabled={busy||supportSubject.trim().length<4||supportBody.trim().length<4} style={[styles.primaryButton,(busy||supportSubject.trim().length<4||supportBody.trim().length<4)&&styles.disabledButton]} onPress={()=>runAction(async()=>{await api.createSupportTicket({category:supportCategory,priority:supportCategory==="safety"?"urgent":"normal",subject:supportSubject.trim(),body:supportBody.trim()});setSupportSubject("");setSupportBody("");},"Caso creado; operaciones ya puede verlo")}><Ionicons name="chatbox-ellipses-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>Enviar a soporte</Text></Pressable></View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View><Text style={styles.foodRestaurantTitle}>Direcciones guardadas</Text><Text style={styles.cardText}>Se comparten entre comidas, viajes y envíos.</Text></View><Ionicons name="map-outline" size={24} color="#7c3cff"/></View>
              {state.addresses.filter(item=>item.userId===user.id).map(item=><View style={styles.savedAddressRow} key={item.id}>
                <View style={[styles.savedAddressIcon,item.isDefault&&styles.savedAddressIconDefault]}><Ionicons name={item.label.toLowerCase().includes("trab")?"business-outline":"home-outline"} size={19} color={item.isDefault?"#fff":"#7c3cff"}/></View>
                <Pressable style={styles.savedAddressCopy} onPress={()=>{setDeliveryAddress(item.address);setPickup(item.address);setShipmentPickup(item.address);setShipmentQuote(null);setShipmentRoadRoute(null);if(item.lat!==null&&item.lng!==null){const point={lat:item.lat,lng:item.lng};setPickupCoords(point);setShipmentPickupCoords(point);}}}><View style={styles.savedAddressTitle}><Text style={styles.sectionTitle}>{item.label}</Text>{item.isDefault&&<Text style={styles.defaultAddressBadge}>Principal</Text>}</View><Text style={styles.cardText}>{item.address}</Text></Pressable>
                {!item.id.startsWith("profile-")&&<View style={styles.savedAddressActions}>{!item.isDefault&&<Pressable disabled={busy} onPress={()=>runAction(()=>api.setDefaultAddress(item.id),"Dirección principal actualizada")}><Ionicons name="star-outline" size={20} color="#7c3cff"/></Pressable>}<Pressable disabled={busy} onPress={()=>Alert.alert("Eliminar dirección",`¿Eliminar ${item.label}?`,[{text:"Cancelar",style:"cancel"},{text:"Eliminar",style:"destructive",onPress:()=>runAction(()=>api.deleteAddress(item.id),"Dirección eliminada")}])}><Ionicons name="trash-outline" size={20} color="#d74a43"/></Pressable></View>}
              </View>)}
              <View style={styles.newAddressForm}><Text style={styles.sectionTitle}>Agregar dirección</Text><View style={styles.newAddressFields}><TextInput style={[styles.input,styles.addressLabelInput]} value={newAddressLabel} onChangeText={setNewAddressLabel} placeholder="Etiqueta"/><TextInput style={[styles.input,styles.addressTextInput]} value={newAddressText} onChangeText={setNewAddressText} placeholder="Calle, número y ciudad"/></View><Pressable style={[styles.primaryButton,(!newAddressLabel.trim()||newAddressText.trim().length<3||busy)&&styles.disabledButton]} disabled={!newAddressLabel.trim()||newAddressText.trim().length<3||busy} onPress={()=>runAction(async()=>{const result=await api.geocode(newAddressText.trim());const match=result.results[0];if(!match)throw new Error("No encontramos esa dirección");await api.createAddress({label:newAddressLabel.trim(),address:match.label,lat:match.point.lat,lng:match.point.lng,isDefault:!state.addresses.some(item=>item.userId===user.id&&!item.id.startsWith("profile-"))});setDeliveryAddress(match.label);setPickup(match.label);setPickupCoords(match.point);setShipmentPickup(match.label);setShipmentPickupCoords(match.point);setShipmentQuote(null);setShipmentRoadRoute(null);setNewAddressText("");},"Dirección guardada con coordenadas reales")}><Ionicons name="add-circle-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>Guardar dirección</Text></Pressable></View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}><View><Text style={styles.foodRestaurantTitle}>Métodos de pago</Text><Text style={styles.cardText}>Sólo guardamos tokens y datos enmascarados.</Text></View><Ionicons name="card-outline" size={24} color="#7c3cff"/></View>
              {state.paymentMethods.filter(method=>method.userId===user.id).map(method=><View style={styles.paymentMethodRow} key={method.id}><View style={[styles.savedAddressIcon,method.isDefault&&styles.savedAddressIconDefault]}><Ionicons name={method.type==="wallet"?"wallet-outline":"card-outline"} size={19} color={method.isDefault?"#fff":"#7c3cff"}/></View><View style={styles.savedAddressCopy}><View style={styles.savedAddressTitle}><Text style={styles.sectionTitle}>{method.label}</Text>{method.isDefault&&<Text style={styles.defaultAddressBadge}>Principal</Text>}</View>{method.expiryMonth&&<Text style={styles.cardText}>Vence {String(method.expiryMonth).padStart(2,"0")}/{method.expiryYear}</Text>}</View>{method.type!=="wallet"&&<View style={styles.savedAddressActions}>{!method.isDefault&&<Pressable disabled={busy} onPress={()=>runAction(()=>api.setDefaultPaymentMethod(method.id),"Método principal actualizado")}><Ionicons name="star-outline" size={20} color="#7c3cff"/></Pressable>}<Pressable disabled={busy} onPress={()=>Alert.alert("Eliminar método",`¿Eliminar ${method.label}?`,[{text:"Cancelar",style:"cancel"},{text:"Eliminar",style:"destructive",onPress:()=>runAction(()=>api.deletePaymentMethod(method.id),"Método eliminado")}])}><Ionicons name="trash-outline" size={20} color="#d74a43"/></Pressable></View>}</View>)}
              <View style={styles.newAddressForm}><Text style={styles.sectionTitle}>Agregar tarjeta sandbox</Text><Text style={styles.cardText}>El SDK del PSP genera el token; Flash nunca recibe el número completo ni el CVV.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{(["visa","mastercard","amex","cabal"] as const).map(brand=><Pressable key={brand} style={[styles.issueCategoryPill,paymentBrand===brand&&styles.issueCategoryPillActive]} onPress={()=>setPaymentBrand(brand)}><Text style={[styles.issueCategoryText,paymentBrand===brand&&styles.issueCategoryTextActive]}>{brand.toUpperCase()}</Text></Pressable>)}</ScrollView><TextInput style={styles.input} value={paymentToken} onChangeText={setPaymentToken} autoCapitalize="none" placeholder="pm_test_token_seguro"/><View style={styles.paymentCompactFields}><TextInput style={[styles.input,styles.paymentCompactInput]} value={paymentLast4} onChangeText={value=>setPaymentLast4(value.replace(/[^0-9]/g,"").slice(0,4))} keyboardType="numeric" placeholder="Últimos 4"/><TextInput style={[styles.input,styles.paymentCompactInput]} value={paymentExpiry} onChangeText={value=>setPaymentExpiry(value.replace(/[^0-9/]/g,"").slice(0,7))} keyboardType="numeric" placeholder="MM/AAAA"/></View><Pressable disabled={busy||!/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken)||paymentLast4.length!==4||!/^\d{2}\/\d{4}$/.test(paymentExpiry)} style={[styles.primaryButton,(busy||!/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken)||paymentLast4.length!==4||!/^\d{2}\/\d{4}$/.test(paymentExpiry))&&styles.disabledButton]} onPress={()=>{const[month,year]=paymentExpiry.split("/").map(Number);runAction(async()=>{await api.createSandboxPaymentMethod({providerToken:paymentToken,brand:paymentBrand,last4:paymentLast4,expiryMonth:month,expiryYear:year});setPaymentToken("");setPaymentLast4("");setPaymentExpiry("");},"Método tokenizado agregado");}}><Ionicons name="shield-checkmark-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>Guardar token seguro</Text></Pressable></View>
            </View>
          </>
        )}
      </ScrollView>
      <OrderTrackingSheet order={state.orders.find(order=>order.id===trackingOrderId&&order.customerId===user.id)||null} driver={state.drivers.find(driver=>driver.id===state.orders.find(order=>order.id===trackingOrderId)?.courierId)||null} onClose={()=>setTrackingOrderId(null)}/>
      <RideTrackingSheet ride={state.rides.find(ride=>ride.id===trackingRideId&&ride.customerId===user.id)||null} driver={state.drivers.find(driver=>driver.id===state.rides.find(ride=>ride.id===trackingRideId)?.driverId)||null} contacts={rideTrustedContacts} pickupCode={trackingRideId?ridePickupCodes[trackingRideId]||null:null} onRevealCode={async()=>{if(!trackingRideId)return;const result=await api.getRidePickupCode(trackingRideId);setRidePickupCodes(current=>({...current,[trackingRideId]:result.pickupCode}));}} onShare={contact=>{const ride=state.rides.find(entry=>entry.id===trackingRideId);if(ride)shareRideLive(ride,contact);}} onSos={()=>{const ride=state.rides.find(entry=>entry.id===trackingRideId);if(ride)confirmRideSos(ride);}} onCancel={()=>{if(trackingRideId)cancelService("ride",trackingRideId);}} onClose={()=>setTrackingRideId(null)}/>
      <ShipmentTrackingSheet shipment={state.shipments.find(shipment=>shipment.id===trackingShipmentId&&shipment.customerId===user.id)||null} driver={state.drivers.find(driver=>driver.id===state.shipments.find(shipment=>shipment.id===trackingShipmentId)?.driverId)||null} shipmentReturn={shipmentReturns.find(entry=>entry.shipmentId===trackingShipmentId)||null} pin={trackingShipmentId?shipmentCodes[trackingShipmentId]||null:null} onRevealPin={async()=>{if(!trackingShipmentId)return;const response=await api.getShipmentDeliveryCode(trackingShipmentId);setShipmentCodes(current=>({...current,[trackingShipmentId]:response.deliveryCode}));}} onClose={()=>setTrackingShipmentId(null)}/>
      <ServiceChatModal jobId={chatJobId} currentUserId={user.id} onClose={()=>setChatJobId(null)}/>
      <Modal transparent visible={Boolean(returnShipmentId)} animationType="slide" onRequestClose={()=>setReturnShipmentId(null)}><View style={styles.issueModalBackdrop}><View style={styles.issueModalSheet}><View style={styles.issueModalHandle}/><View style={styles.issueModalHeader}><View><Text style={styles.substitutionEyebrow}>LOGÍSTICA INVERSA</Text><Text style={styles.foodRestaurantTitle}>Solicitar devolución</Text></View><Pressable style={styles.issueModalClose} onPress={()=>setReturnShipmentId(null)}><Ionicons name="close" size={21} color="#403a43"/></Pressable></View><Text style={styles.cardText}>Operaciones validará el motivo antes de programar el retiro.</Text><TextInput multiline numberOfLines={4} value={returnReason} onChangeText={setReturnReason} maxLength={500} placeholder="Explicá por qué necesitás devolver el envío" style={[styles.input,styles.issueDescriptionInput]}/><Pressable disabled={busy||returnReason.trim().length<5} style={[styles.issueSubmitButton,(busy||returnReason.trim().length<5)&&styles.disabledButton]} onPress={()=>{const shipmentId=returnShipmentId;if(!shipmentId)return;runAction(async()=>{const result=await api.requestShipmentReturn(shipmentId,returnReason.trim());setShipmentReturns(current=>[result.return,...current]);setReturnShipmentId(null);setReturnReason("");},"Solicitud de devolución registrada");}}><Ionicons name="return-down-back" size={18} color="#fff"/><Text style={styles.issueSubmitText}>Enviar solicitud</Text></Pressable></View></View></Modal>
      <Modal transparent visible={Boolean(claimShipmentId)} animationType="slide" onRequestClose={()=>setClaimShipmentId(null)}><View style={styles.issueModalBackdrop}><View style={styles.issueModalSheet}><View style={styles.issueModalHandle}/><View style={styles.issueModalHeader}><View><Text style={styles.substitutionEyebrow}>PROTECCIÓN FLASH</Text><Text style={styles.foodRestaurantTitle}>Reportar siniestro</Text></View><Pressable style={styles.issueModalClose} onPress={()=>setClaimShipmentId(null)}><Ionicons name="close" size={21} color="#403a43"/></Pressable></View><Text style={styles.cardText}>La cobertura y franquicia se validan contra el contrato del envío. La aprobación no simula un pago externo.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.issueCategoryRail}>{([['lost','Extraviado'],['damaged','Dañado'],['stolen','Robado']] as const).map(([value,label])=><Pressable key={value} style={[styles.issueCategoryPill,claimType===value&&styles.issueCategoryPillActive]} onPress={()=>setClaimType(value)}><Text style={[styles.issueCategoryText,claimType===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView><TextInput multiline numberOfLines={4} value={claimDescription} onChangeText={setClaimDescription} maxLength={1000} placeholder="Describí qué ocurrió y qué evidencia tenés" style={[styles.input,styles.issueDescriptionInput]}/><TextInput value={claimAmount} onChangeText={value=>setClaimAmount(value.replace(/[^0-9]/g,""))} keyboardType="numeric" placeholder="Monto reclamado" style={styles.input}/><Pressable disabled={busy||claimDescription.trim().length<10||!Number(claimAmount)} style={[styles.issueSubmitButton,(busy||claimDescription.trim().length<10||!Number(claimAmount))&&styles.disabledButton]} onPress={()=>{const shipmentId=claimShipmentId;if(!shipmentId)return;runAction(async()=>{const result=await api.createShipmentClaim(shipmentId,{claimType,description:claimDescription.trim(),requestedAmount:Number(claimAmount)});setShipmentClaims(current=>[result.claim,...current]);setClaimShipmentId(null);},"Siniestro registrado para revisión");}}><Ionicons name="shield-checkmark-outline" size={18} color="#fff"/><Text style={styles.issueSubmitText}>Enviar reclamo</Text></Pressable></View></View></Modal>
      <Modal transparent visible={Boolean(issueOrderId)} animationType="slide" onRequestClose={()=>setIssueOrderId(null)}><View style={styles.issueModalBackdrop}><View style={styles.issueModalSheet}><View style={styles.issueModalHandle}/><View style={styles.issueModalHeader}><View><Text style={styles.substitutionEyebrow}>Ayuda con tu pedido</Text><Text style={styles.foodRestaurantTitle}>Reportar un problema</Text></View><Pressable style={styles.issueModalClose} onPress={()=>setIssueOrderId(null)}><Ionicons name="close" size={21} color="#403a43"/></Pressable></View><Text style={styles.cardText}>Operaciones revisará el caso y, si corresponde, realizará un reintegro parcial a tu Wallet.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.issueCategoryRail}>{([ ["missing_item","Faltó un producto"],["wrong_item","Producto incorrecto"],["damaged_item","Llegó dañado"],["quality","Problema de calidad"],["late","Demora"],["other","Otro"] ] as const).map(([value,label])=><Pressable key={value} style={[styles.issueCategoryPill,issueCategory===value&&styles.issueCategoryPillActive]} onPress={()=>setIssueCategory(value)}><Text style={[styles.issueCategoryText,issueCategory===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView><Text style={styles.issueFieldLabel}>Contanos qué pasó</Text><TextInput multiline numberOfLines={4} value={issueDescription} onChangeText={setIssueDescription} placeholder="Ej.: faltaron las papas del combo" style={[styles.input,styles.issueDescriptionInput]}/><Text style={styles.issueFieldLabel}>Reintegro solicitado</Text><View style={styles.issueMoneyInput}><Text style={styles.issueMoneyPrefix}>$</Text><TextInput value={issueRefund} onChangeText={value=>setIssueRefund(value.replace(/[^0-9]/g,""))} keyboardType="numeric" placeholder="0" style={styles.issueMoneyTextInput}/></View><View style={styles.issueSecurityNote}><Ionicons name="shield-checkmark-outline" size={18} color="#087a50"/><Text style={styles.issueSecurityText}>No se mueve dinero hasta que operaciones valide la evidencia y el importe.</Text></View><Pressable disabled={busy||issueDescription.trim().length<5||!Number(issueRefund)||!issueOrderId} style={[styles.issueSubmitButton,(busy||issueDescription.trim().length<5||!Number(issueRefund))&&styles.disabledButton]} onPress={()=>{const orderId=issueOrderId;if(!orderId)return;runAction(async()=>{await api.createOrderIssue(orderId,{category:issueCategory,description:issueDescription.trim(),requestedRefund:Number(issueRefund)});setIssueOrderId(null);setIssueDescription("");setIssueRefund("");},"Incidencia enviada a operaciones");}}><Ionicons name="paper-plane-outline" size={18} color="#fff"/><Text style={styles.issueSubmitText}>Enviar incidencia</Text></Pressable></View></View></Modal>
      <View style={styles.foodBottomNav}>
        <Pressable
          onPress={() => {
            setSharedView("service");
            setFoodScreen("home");
          }}
          style={styles.foodBottomItem}
        >
          <Ionicons
            name="home-outline"
            size={21}
            color={
              sharedView === "service" && foodScreen === "home"
                ? "#ff6a21"
                : "#9c989f"
            }
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "service" &&
                foodScreen === "home" &&
                styles.foodBottomLabelActive,
            ]}
          >
            Inicio
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSharedView("service");
            if (customerWindow === "food") setFoodScreen("search");
          }}
          style={styles.foodBottomItem}
        >
          <Ionicons
            name="search-outline"
            size={21}
            color={
              sharedView === "service" && foodScreen === "search"
                ? "#ff6a21"
                : "#9c989f"
            }
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "service" &&
                foodScreen === "search" &&
                styles.foodBottomLabelActive,
            ]}
          >
            Buscar
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSharedView("activity")}
          style={styles.foodBottomItem}
        >
          <Ionicons
            name="time-outline"
            size={21}
            color={sharedView === "activity" ? "#ff6a21" : "#9c989f"}
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "activity" && styles.foodBottomLabelActive,
            ]}
          >
            Actividad
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSharedView("account")}
          style={styles.foodBottomItem}
        >
          <Ionicons
            name="person-outline"
            size={21}
            color={sharedView === "account" ? "#ff6a21" : "#9c989f"}
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "account" && styles.foodBottomLabelActive,
            ]}
          >
            Cuenta
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function LoginScreen({
  busy,
  onLogin,
  onRegister,
}: {
  busy: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<{user:User;verificationRequired:true;developmentCode?:string;expiresAt?:string}>;
}) {
  const [creating, setCreating] = useState(false);
  const [recoveryStep,setRecoveryStep]=useState<"none"|"request"|"confirm">("none");
  const [recoveryToken,setRecoveryToken]=useState("");
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const [verificationEmail,setVerificationEmail]=useState("");
  const [verificationCode,setVerificationCode]=useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    setError("");
    if(verificationEmail){try{setRecoveryBusy(true);await api.confirmEmailVerification(verificationEmail,verificationCode.trim());await onLogin(verificationEmail,password);setVerificationEmail("");setVerificationCode("");}catch(verificationError){setError(verificationError instanceof Error?verificationError.message:"No se pudo verificar el email");}finally{setRecoveryBusy(false);}return;}
    if(recoveryStep==="request"){
      try{setRecoveryBusy(true);const result=await api.requestPasswordRecovery(email.trim().toLowerCase());setRecoveryToken(result.developmentToken||"");setRecoveryStep("confirm");Alert.alert("Revisá tu email",result.message);}catch(recoveryError){setError(recoveryError instanceof Error?recoveryError.message:"No se pudo iniciar la recuperación");}finally{setRecoveryBusy(false);}return;
    }
    if(recoveryStep==="confirm"){
      if(password!==confirmation)return setError("Las contraseñas no coinciden");
      try{setRecoveryBusy(true);await api.confirmPasswordRecovery(recoveryToken.trim(),password);setRecoveryStep("none");setRecoveryToken("");setPassword("");setConfirmation("");Alert.alert("Contraseña actualizada","Todas las sesiones anteriores fueron cerradas. Ya podés ingresar.");}catch(recoveryError){setError(recoveryError instanceof Error?recoveryError.message:"No se pudo cambiar la contraseña");}finally{setRecoveryBusy(false);}return;
    }
    if (creating && password !== confirmation)
      return setError("Las contraseñas no coinciden");
    try {
      if (creating){
        const registration=await onRegister({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          phone: phone.trim() || undefined,
        });setVerificationEmail(email.trim().toLowerCase());setVerificationCode(registration.developmentCode||"");setCreating(false);Alert.alert("Verificá tu email","Ingresá el código de seis dígitos que enviamos.");
      } else await onLogin(email.trim().toLowerCase(), password);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "No se pudo iniciar sesion",
      );
      if(!creating&&recoveryStep==="none"&&loginError instanceof Error&&loginError.message.includes("verificar")){const normalized=email.trim().toLowerCase();setVerificationEmail(normalized);try{const resent=await api.resendEmailVerification(normalized);setVerificationCode(resent.developmentCode||"");}catch(_error){}}
    }
  };
  return (
    <LinearGradient
      colors={["#6f00ff", "#a000ff", "#ff4b20"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.loginRoot}
    >
      <View style={styles.loginGlow} />
      <View style={styles.loginBrand}>
        <View style={styles.loginMark}>
          <Ionicons name="flash" size={36} color="#7c00ff" />
        </View>
        <Text style={styles.loginTitle}>Flash</Text>
        <Text style={styles.loginCopy}>
          Todo lo que necesitás, moviéndose con vos.
        </Text>
      </View>
      <View style={styles.loginCard}>
        <Text style={styles.rideTitle}>
          {verificationEmail?"Verificá tu email":recoveryStep!=="none"?(recoveryStep==="request"?"Recuperar cuenta":"Nueva contraseña"):creating?"Crear tu cuenta":"Ingresar"}
        </Text>
        <Text style={styles.helperText}>
          {verificationEmail?`Enviamos un código de seis dígitos a ${verificationEmail}.`:recoveryStep==="request"?"Te enviaremos un código temporal si la cuenta existe.":recoveryStep==="confirm"?"Ingresá el código recibido y elegí una contraseña nueva.":creating
            ? "Una sola cuenta para comidas, viajes y envíos."
            : "Accedé de forma segura a tu cuenta Flash."}
        </Text>
        {creating && recoveryStep==="none" ? (
          <TextInput
            value={name}
            onChangeText={setName}
            autoComplete="name"
            placeholder="Nombre y apellido"
            style={styles.input}
          />
        ) : null}
        {creating && recoveryStep==="none" ? (
          <TextInput
            value={phone}
            onChangeText={setPhone}
            autoComplete="tel"
            keyboardType="phone-pad"
            placeholder="Teléfono (opcional)"
            style={styles.input}
          />
        ) : null}
        {recoveryStep==="confirm" ? <TextInput value={recoveryToken} onChangeText={setRecoveryToken} autoCapitalize="none" placeholder="Código de recuperación" style={styles.input}/> : null}
        {verificationEmail ? <TextInput value={verificationCode} onChangeText={value=>setVerificationCode(value.replace(/\D/g,"").slice(0,6))} keyboardType="number-pad" placeholder="Código de 6 dígitos" style={styles.input}/> : null}
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          editable={!verificationEmail}
          style={styles.input}
        />
        {recoveryStep!=="request" ? <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Contraseña"
          style={styles.input}
        /> : null}
        {creating || recoveryStep==="confirm" ? (
          <TextInput
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
            placeholder="Repetir contraseña"
            style={styles.input}
          />
        ) : null}
        {error ? <Text style={styles.loginError}>{error}</Text> : null}
        <ActionButton
          label={
            busy||recoveryBusy?"Procesando...":verificationEmail?"Verificar y entrar":recoveryStep==="request"?"Enviar instrucciones":recoveryStep==="confirm"?"Cambiar contraseña":creating?"Crear cuenta":"Continuar"
          }
          disabled={
            busy || recoveryBusy ||
            !email ||
            (Boolean(verificationEmail)&&verificationCode.length!==6) ||
            (recoveryStep!=="request"&&password.length < (creating||recoveryStep==="confirm" ? 8 : 1)) ||
            (recoveryStep==="confirm"&&(!recoveryToken.trim()||!confirmation)) ||
            (creating && (!name.trim() || !confirmation))
          }
          onPress={submit}
        />
        {recoveryStep==="none"&&!verificationEmail ? <Pressable
          onPress={() => {
            setCreating((value) => !value);
            setError("");
            setPassword("");
            setConfirmation("");
          }}
          disabled={busy||recoveryBusy}
          style={styles.loginSwitch}
        >
          <Text style={styles.loginSwitchText}>
            {creating
              ? "¿Ya tenés cuenta? Ingresar"
              : "¿Sos nuevo? Crear una cuenta"}
          </Text>
        </Pressable> : null}
        {!creating&&recoveryStep==="none"&&!verificationEmail?<Pressable disabled={busy||recoveryBusy} style={styles.loginSwitch} onPress={()=>{setRecoveryStep("request");setError("");setPassword("");setConfirmation("");}}><Text style={styles.loginSwitchText}>Olvidé mi contraseña</Text></Pressable>:null}
        {recoveryStep!=="none"?<Pressable disabled={busy||recoveryBusy} style={styles.loginSwitch} onPress={()=>{setRecoveryStep("none");setRecoveryToken("");setPassword("");setConfirmation("");setError("");}}><Text style={styles.loginSwitchText}>Volver a ingresar</Text></Pressable>:null}
        {verificationEmail?<><Pressable disabled={busy||recoveryBusy} style={styles.loginSwitch} onPress={async()=>{try{setRecoveryBusy(true);const resent=await api.resendEmailVerification(verificationEmail);setVerificationCode(resent.developmentCode||"");Alert.alert("Código reenviado",resent.message);}catch(resendError){setError(resendError instanceof Error?resendError.message:"No se pudo reenviar");}finally{setRecoveryBusy(false);}}}><Text style={styles.loginSwitchText}>Reenviar código</Text></Pressable><Pressable disabled={busy||recoveryBusy} style={styles.loginSwitch} onPress={()=>{setVerificationEmail("");setVerificationCode("");setPassword("");setError("");}}><Text style={styles.loginSwitchText}>Usar otra cuenta</Text></Pressable></>:null}
      </View>
    </LinearGradient>
  );
}

function MerchantScreen({
  restaurant,
  orders,
  busy,
  runAction,
  onRefresh,
}: {
  restaurant: Restaurant;
  orders: Order[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onRefresh:()=>Promise<void>;
}) {
  const merchantScrollRef=useRef<ScrollView>(null);
  const [merchantView,setMerchantView]=useState<"today"|"orders"|"catalog"|"account">("today");
  const [chatJobId,setChatJobId]=useState<string|null>(null);
  const [detailOrderId,setDetailOrderId]=useState<string|null>(null);
  const [operations,setOperations]=useState<MerchantOperationsDashboard|null>(null);
  const [activeOrders,setActiveOrders]=useState<Order[]>([]);
  const [activeOrdersHasMore,setActiveOrdersHasMore]=useState(false);
  const [operationsLoading,setOperationsLoading]=useState(true);
  const [operationsError,setOperationsError]=useState("");
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    category: "Especiales",
    price: "",
  });
  useEffect(()=>{merchantScrollRef.current?.scrollTo({y:0,animated:false});},[merchantView]);
  const restaurantOrders = orders.filter(
    (order) => order.restaurantId === restaurant.id,
  );
  const orderStatusSignature=restaurantOrders.map(order=>`${order.id}:${order.status}`).join("|");
  const stockSignature=restaurant.menu.map(item=>`${item.id}:${item.stock}`).join("|");
  const loadOperations=useCallback(async()=>{
    setOperationsLoading(true);
    try{
      const [result,queue]=await Promise.all([api.getMerchantDashboard(restaurant.id),api.getMerchantActiveOrders(restaurant.id)]);
      setOperations(result.dashboard);
      setActiveOrders(queue.orders);
      setActiveOrdersHasMore(queue.hasMore);
      setOperationsError("");
    }catch(error){setOperationsError(error instanceof Error?error.message:"No se pudo actualizar la operación");}
    finally{setOperationsLoading(false);}
  },[restaurant.id]);
  useEffect(()=>{
    void loadOperations();
    const timer=setInterval(()=>void loadOperations(),30_000);
    return()=>clearInterval(timer);
  },[loadOperations,orderStatusSignature,restaurant.etaMin,restaurant.manualOpen,stockSignature]);
  const metrics=operations?.metrics;
  const manualOpen=operations?.branch?.manualOpen??restaurant.manualOpen??restaurant.open;
  const effectiveOpen=operations?.branch?.open??restaurant.open;
  const etaMin=operations?.branch?.etaMin??restaurant.etaMin;
  const updatedAt=operations?new Intl.DateTimeFormat("es-AR",{hour:"2-digit",minute:"2-digit",timeZone:operations.timezone}).format(new Date(operations.generatedAt)):null;
  const detailOrder=activeOrders.find(order=>order.id===detailOrderId)||null;
  return (
    <View style={styles.merchantShell}>
      <ServiceChatModal jobId={chatJobId} currentUserId={restaurant.ownerId} onClose={()=>setChatJobId(null)}/>
      <MerchantOrderDetailModal order={detailOrder} restaurant={restaurant} busy={busy} onClose={()=>setDetailOrderId(null)} onOpenChat={orderId=>{setDetailOrderId(null);setChatJobId(orderId);}} onChanged={async()=>{await onRefresh();await loadOperations();}}/>
      <ScrollView ref={merchantScrollRef} contentContainerStyle={styles.merchantContent} refreshControl={<RefreshControl refreshing={operationsLoading} onRefresh={async()=>{await onRefresh();await loadOperations();}}/>}>
      <View style={styles.stack}>
      {merchantView==="today"?<>
      <LinearGradient colors={["#2d180e","#12100f"]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.merchantHero}>
        <View style={styles.merchantHeroTopline}><View style={[styles.merchantLiveDot,effectiveOpen?styles.merchantLiveDotOpen:styles.merchantLiveDotPaused]}/><Text style={styles.heroLabel}>{!manualOpen?"Pausado por el local":effectiveOpen?"Abierto y recibiendo":"Fuera de horario"}</Text></View>
        <Text style={styles.heroTitle}>{restaurant.name}</Text>
        <Text style={styles.heroCopy}>{operations?.branch?.name||restaurant.address}</Text>
        <View style={styles.merchantHeroMeta}><Text style={styles.merchantHeroMetaText}>{etaMin} min ETA</Text><Text style={styles.merchantHeroMetaText}>{operations?.timezone||"Zona horaria pendiente"}</Text></View>
      </LinearGradient>
      <View style={[styles.merchantSync,operationsError?styles.merchantSyncError:styles.merchantSyncLive]}>
        <View style={styles.merchantSyncCopy}><Text style={styles.merchantSyncTitle}>{operationsError?(operations?"Última lectura conservada":"Operación sin actualizar"):operations?.source==="postgres-live-operations"?"Operación PostgreSQL en vivo":operations?"Modo local explícito":"Conectando operación"}</Text><Text style={styles.merchantSyncDetail}>{operationsError?`${operationsError}${updatedAt?` · Último dato ${updatedAt}`:""}`:(updatedAt?`Actualizado ${updatedAt}`:"Consultando la fuente autoritativa")}</Text></View>
        {operationsLoading?<ActivityIndicator size="small" color="#ff7a2d"/>:<Pressable accessibilityRole="button" accessibilityLabel="Actualizar operación" onPress={()=>void loadOperations()} style={styles.merchantSyncButton}><Ionicons name="refresh" size={17} color="#28150d"/></Pressable>}
      </View>
      <KpiRow
        items={[
          ["Venta de hoy",metrics?money.format(metrics.grossSalesToday):"—"],
          ["Activos",metrics?.activeOrders??"—"],
          ["Ticket hoy",metrics?money.format(metrics.averageTicketToday):"—"],
          ["Atención",metrics?metrics.needsAction+metrics.lateOrders:"—"],
        ]}
      />
      <View style={styles.merchantPulseCard}>
        <View style={styles.merchantPulseHeader}><View><Text style={styles.merchantPulseEyebrow}>AHORA</Text><Text style={styles.merchantPulseTitle}>Pulso de cocina</Text></View><Text style={styles.merchantPulseTotal}>{metrics?`${metrics.activeOrders} en flujo`:"Sin sincronizar"}</Text></View>
        <View style={styles.merchantPulseGrid}>{[["Por aceptar",metrics?.needsAction],["Preparando",metrics?.preparing],["Listos",metrics?.readyForPickup],["Con courier",metrics?.courierFlow],["Sin stock",metrics?.unavailableItems]].map(([label,value])=><View key={String(label)} style={styles.merchantPulseStage}><Text style={styles.merchantPulseStageValue}>{value??"—"}</Text><Text style={styles.merchantPulseStageLabel}>{label}</Text></View>)}</View>
        {metrics&&(metrics.lateOrders>0||metrics.untrackedPrepOrders>0)?<View style={styles.merchantSlaAlert}><Ionicons name="warning-outline" size={18} color="#b33a25"/><Text style={styles.merchantSlaAlertText}>{metrics.lateOrders>0?`${metrics.lateOrders} fuera de plazo. `:""}{metrics.untrackedPrepOrders>0?`${metrics.untrackedPrepOrders} sin SLA histórico observado.`:""}</Text></View>:null}
      </View>
      <View style={styles.actionRow}>
        <ActionButton
          label={manualOpen ? "Pausar pedidos" : "Abrir pedidos"}
          disabled={busy}
          onPress={() =>
            runAction(
              () => api.updateRestaurant(restaurant.id, { open: !manualOpen }),
              "Estado actualizado",
            )
          }
        />
        <ActionButton
          label="+5 min ETA"
          disabled={busy}
          onPress={() =>
            runAction(
              () =>
                api.updateRestaurant(restaurant.id, {
                  etaMin: etaMin + 5,
                }),
              "ETA actualizada",
            )
          }
        />
      </View>
      </>:null}
      {merchantView==="orders"?<>
      <View style={styles.merchantScreenHeading}><Text style={styles.merchantScreenEyebrow}>OPERACIÓN</Text><Text style={styles.merchantScreenTitle}>Pedidos activos</Text><Text style={styles.merchantScreenCopy}>La cola se prioriza por responsabilidad de cocina, plazo y etapa logística.</Text></View>
      <View style={styles.merchantOrderSummary}>{[["Por aceptar",metrics?.needsAction],["Preparando",metrics?.preparing],["Listos",metrics?.readyForPickup],["Courier",metrics?.courierFlow]].map(([label,value])=><View key={String(label)} style={styles.merchantOrderSummaryItem}><Text style={styles.merchantOrderSummaryValue}>{value??"—"}</Text><Text style={styles.merchantOrderSummaryLabel}>{label}</Text></View>)}</View>
      <Text style={styles.sectionTitle}>Cocina en vivo</Text>
      {activeOrdersHasMore?<View style={styles.merchantSlaAlert}><Ionicons name="warning-outline" size={18} color="#b33a25"/><Text style={styles.merchantSlaAlertText}>La cola supera los 100 pedidos activos. Se muestran primero los que requieren acción.</Text></View>:null}
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.stack}><OrderCard
          order={order}
          disabled={busy}
          onPress={["accepted","preparing"].includes(order.status) ? () =>
            runAction(() => api.advanceOrder(order.id), "Pedido avanzado")
          :undefined}
        /><View style={styles.merchantOrderActions}><Pressable style={styles.merchantOrderDetailAction} onPress={()=>setDetailOrderId(order.id)}><Ionicons name="receipt-outline" size={18} color="#9a3e12"/><Text style={styles.merchantOrderDetailActionText}>Ver comanda</Text></Pressable><Pressable style={styles.shareAction} onPress={()=>setChatJobId(order.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat</Text></Pressable></View></View>
      ))}
      {activeOrders.length === 0 && (
        <View style={styles.merchantEmpty}><Ionicons name="checkmark-circle-outline" size={28} color="#1d9b63"/><Text style={styles.merchantEmptyTitle}>{operationsLoading?"Sincronizando la cola":"Cocina al día"}</Text><Text style={styles.merchantEmptyCopy}>{operationsLoading?"Consultando pedidos activos en PostgreSQL…":"No hay pedidos activos para gestionar."}</Text></View>
      )}
      </>:null}
      {merchantView==="catalog"?<>
      <View style={styles.merchantScreenHeading}><Text style={styles.merchantScreenEyebrow}>MENÚ</Text><Text style={styles.merchantScreenTitle}>Catálogo y stock</Text><Text style={styles.merchantScreenCopy}>{metrics?`${restaurant.menu.length-metrics.unavailableItems} disponibles · ${metrics.unavailableItems} sin stock`:"Sincronizando inventario de la sucursal"}</Text></View>
      <Text style={styles.sectionTitle}>Menu y stock</Text>
      {restaurant.menu.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <View style={styles.itemCopy}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.cardText}>
              {money.format(item.price)} -{" "}
              {item.stock ? "Disponible" : "Agotado"}
            </Text>
          </View>
          <ActionButton
            label={item.stock ? "Agotar" : "Reponer"}
            disabled={busy}
            onPress={() =>
              runAction(
                () => api.updateMenuStock(restaurant.id, item.id, !item.stock),
                "Stock actualizado",
              )
            }
          />
        </View>
      ))}
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Agregar producto</Text>
        <TextInput
          value={newItem.name}
          onChangeText={(value) =>
            setNewItem((current) => ({ ...current, name: value }))
          }
          placeholder="Nombre"
          style={styles.input}
        />
        <TextInput
          value={newItem.description}
          onChangeText={(value) =>
            setNewItem((current) => ({ ...current, description: value }))
          }
          placeholder="Descripcion"
          style={styles.input}
        />
        <TextInput
          value={newItem.category}
          onChangeText={(value) =>
            setNewItem((current) => ({ ...current, category: value }))
          }
          placeholder="Categoria"
          style={styles.input}
        />
        <TextInput
          value={newItem.price}
          onChangeText={(value) =>
            setNewItem((current) => ({ ...current, price: value }))
          }
          placeholder="Precio"
          keyboardType="numeric"
          style={styles.input}
        />
        <ActionButton
          label="Crear producto"
          disabled={busy || !newItem.name.trim() || Number(newItem.price) <= 0}
          onPress={() =>
            runAction(async () => {
              await api.addMenuItem(restaurant.id, {
                name: newItem.name.trim(),
                description: newItem.description.trim(),
                category: newItem.category.trim() || "Especiales",
                price: Number(newItem.price),
              });
              setNewItem({
                name: "",
                description: "",
                category: "Especiales",
                price: "",
              });
            }, "Producto creado")
          }
        />
      </View>
      </>:null}
      {merchantView==="account"?<>
        <View style={styles.merchantScreenHeading}><Text style={styles.merchantScreenEyebrow}>TU NEGOCIO</Text><Text style={styles.merchantScreenTitle}>{restaurant.name}</Text><Text style={styles.merchantScreenCopy}>Identidad operativa, sucursales y procedencia de los datos.</Text></View>
        <View style={styles.merchantAccountCard}><View style={styles.merchantAccountIcon}><Ionicons name="storefront-outline" size={24} color="#fff"/></View><View style={styles.merchantAccountCopy}><Text style={styles.merchantAccountCardTitle}>{operations?.branch?.name||restaurant.address}</Text><Text style={styles.merchantAccountCardDetail}>{operations?.timezone||"Zona horaria sin sincronizar"}</Text></View><Text style={[styles.merchantAccountStatus,effectiveOpen?styles.merchantAccountStatusOpen:styles.merchantAccountStatusPaused]}>{effectiveOpen?"Abierto":"Cerrado"}</Text></View>
        <View style={styles.formCard}><Text style={styles.sectionTitle}>Sucursales</Text>{(restaurant.branches||[]).map(branch=><View key={branch.id} style={styles.merchantBranchRow}><View style={[styles.merchantBranchPin,branch.open?styles.merchantBranchPinOpen:styles.merchantBranchPinClosed]}><Ionicons name="location-outline" size={19} color={branch.open?"#15764c":"#98532e"}/></View><View style={styles.merchantAccountCopy}><Text style={styles.itemName}>{branch.name}</Text><Text style={styles.cardText}>{branch.address}</Text><Text style={styles.merchantBranchMeta}>{branch.etaMin} min · {branch.manualOpen?branch.open?"Abierta ahora":"Fuera de horario":"Pausada manualmente"}</Text></View></View>)}{!restaurant.branches?.length?<Text style={styles.muted}>No hay sucursales configuradas.</Text>:null}</View>
        <View style={styles.merchantDataCard}><Ionicons name="shield-checkmark-outline" size={22} color="#1b8859"/><View style={styles.merchantAccountCopy}><Text style={styles.merchantAccountTitle}>{operations?.source==="postgres-live-operations"?"Datos operativos PostgreSQL":"Fuente local explícita"}</Text><Text style={styles.merchantAccountDetail}>{updatedAt?`Última lectura ${updatedAt}`:"Esperando primera lectura"} · Los datos retenidos se identifican cuando falla una actualización.</Text></View></View>
      </>:null}
      </View>
      </ScrollView>
      <View style={styles.merchantBottomNav}>{([['today','home-outline','Hoy'],['orders','receipt-outline','Pedidos'],['catalog','restaurant-outline','Catálogo'],['account','person-circle-outline','Cuenta']] as const).map(([value,icon,label])=><Pressable key={value} style={[styles.merchantBottomItem,merchantView===value&&styles.merchantBottomItemActive]} onPress={()=>setMerchantView(value)} accessibilityRole="tab" accessibilityState={{selected:merchantView===value}}><View style={styles.merchantBottomIconWrap}><Ionicons name={icon} size={22} color={merchantView===value?"#ef641f":"#8b817b"}/>{value==="orders"&&Boolean(metrics?.needsAction||metrics?.lateOrders)?<View style={styles.merchantBottomDot}/>:null}</View><Text style={[styles.merchantBottomLabel,merchantView===value&&styles.merchantBottomLabelActive]}>{label}</Text></Pressable>)}</View>
    </View>
  );
}

function MerchantOrderDetailModal({
  order,
  restaurant,
  busy,
  onClose,
  onOpenChat,
  onChanged,
}: {
  order: Order | null;
  restaurant: Restaurant;
  busy: boolean;
  onClose: () => void;
  onOpenChat: (orderId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [substitutions,setSubstitutions]=useState<OrderSubstitution[]>([]);
  const [selectedItemId,setSelectedItemId]=useState("");
  const [replacementId,setReplacementId]=useState("");
  const [reason,setReason]=useState("");
  const [loading,setLoading]=useState(false);
  const [actionBusy,setActionBusy]=useState(false);
  const [error,setError]=useState("");
  const loadSubstitutions=useCallback(async(orderId:string)=>{
    setLoading(true);
    try{const result=await api.getOrderSubstitutions(orderId);setSubstitutions(result.substitutions);setError("");}
    catch(loadError){setError(loadError instanceof Error?loadError.message:"No se pudieron cargar las sustituciones");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{
    setSelectedItemId("");setReplacementId("");setReason("");setSubstitutions([]);setError("");
    if(order)void loadSubstitutions(order.id);
  },[order?.id,loadSubstitutions]);
  if(!order)return null;
  const selectedOrderItem=order.items.find(item=>item.menuItemId===selectedItemId)||null;
  const selectedCatalogItem=restaurant.menu.find(item=>item.id===selectedItemId)||null;
  const branch=restaurant.branches?.find(entry=>entry.id===order.branchId)||null;
  const inventoryFor=(itemId:string)=>branch?.inventory?.[itemId];
  const isAvailable=(item:Restaurant["menu"][number])=>{
    const branchInventory=inventoryFor(item.id);
    return item.stock&&(branchInventory?.available??true)&&(branchInventory?.stockQuantity==null||branchInventory.stockQuantity>=(selectedOrderItem?.quantity||1));
  };
  const originalPrice=selectedOrderItem?.unitPrice??selectedCatalogItem?.price??0;
  const candidates=restaurant.menu.filter(item=>item.id!==selectedItemId&&isAvailable(item)&&item.price<=originalPrice).sort((left,right)=>Number(Boolean(selectedCatalogItem?.category)&&right.category===selectedCatalogItem?.category)-Number(Boolean(selectedCatalogItem?.category)&&left.category===selectedCatalogItem?.category)||left.price-right.price);
  const canManage=["accepted","preparing"].includes(order.status);
  const selectedPending=substitutions.some(entry=>entry.status==="pending"&&entry.original.id===selectedItemId);
  const submitSubstitution=async()=>{
    if(!order.branchId||!selectedOrderItem?.menuItemId||!replacementId||reason.trim().length<3)return;
    setActionBusy(true);setError("");
    try{
      const branchInventory=inventoryFor(selectedOrderItem.menuItemId);
      if(selectedCatalogItem?.stock&&(branchInventory?.available??true))await api.updateBranchInventory(restaurant.id,order.branchId,selectedOrderItem.menuItemId,{available:false,stockQuantity:branchInventory?.stockQuantity??null});
      const result=await api.proposeOrderSubstitution(order.id,{originalMenuItemId:selectedOrderItem.menuItemId,replacementMenuItemId:replacementId,reason:reason.trim()});
      setSubstitutions(current=>[result.substitution,...current]);
      setSelectedItemId("");setReplacementId("");setReason("");
      await onChanged();
      Alert.alert("Propuesta enviada","El cliente debe aceptar o rechazar el cambio antes de que cocina pueda avanzar.");
    }catch(substitutionError){setError(substitutionError instanceof Error?substitutionError.message:"No se pudo proponer la sustitución");}
    finally{setActionBusy(false);}
  };
  const createdLabel=order.createdAt?new Date(order.createdAt).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"Hora no disponible";
  return <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.merchantDetailBackdrop}>
      <View style={styles.merchantDetailSheet}>
        <View style={styles.issueModalHandle}/>
        <View style={styles.issueModalHeader}><View style={styles.merchantDetailHeading}><Text style={styles.merchantScreenEyebrow}>COMANDA {order.id}</Text><Text style={styles.merchantDetailTitle}>{mobileOrderStatusLabel[order.status]}</Text><Text style={styles.merchantDetailSubtitle}>{createdLabel} · {order.branchId?branch?.name||order.branchId:"Sucursal no registrada"}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar detalle" style={styles.issueModalClose} onPress={onClose}><Ionicons name="close" size={21} color="#403a43"/></Pressable></View>
        <ScrollView style={styles.merchantDetailScroll} contentContainerStyle={styles.merchantDetailContent} keyboardShouldPersistTaps="handled">
          <View style={styles.merchantDetailFacts}><View style={styles.merchantDetailFact}><Text style={styles.merchantDetailFactLabel}>Total</Text><Text style={styles.merchantDetailFactValue}>{money.format(order.total)}</Text></View><View style={styles.merchantDetailFact}><Text style={styles.merchantDetailFactLabel}>Entrega estimada</Text><Text style={styles.merchantDetailFactValue}>{order.etaMin} min</Text></View><View style={styles.merchantDetailFact}><Text style={styles.merchantDetailFactLabel}>Courier</Text><Text style={styles.merchantDetailFactValue}>{order.courierId?"Asignado":"Pendiente"}</Text></View></View>
          <View style={styles.merchantDetailSection}><Text style={styles.sectionTitle}>Productos</Text>{order.items.map((item,index)=>{const menuId=item.menuItemId||"";const catalogItem=restaurant.menu.find(entry=>entry.id===menuId);const itemInventory=menuId?inventoryFor(menuId):undefined;const unavailable=Boolean(catalogItem&&!catalogItem.stock)||itemInventory?.available===false;const hasPending=substitutions.some(entry=>entry.status==="pending"&&entry.original.id===menuId);return <View key={`${menuId||item.name}-${index}`} style={[styles.merchantDetailItem,selectedItemId===menuId&&styles.merchantDetailItemSelected]}><View style={styles.merchantDetailQuantity}><Text style={styles.merchantDetailQuantityText}>{item.quantity}×</Text></View><View style={styles.merchantDetailItemCopy}><View style={styles.merchantDetailItemTitleRow}><Text style={styles.merchantDetailItemTitle}>{item.name}</Text>{unavailable?<Text style={styles.merchantUnavailableBadge}>SIN STOCK</Text>:null}</View>{typeof item.unitPrice==="number"?<Text style={styles.merchantDetailItemPrice}>{money.format(item.unitPrice)} c/u</Text>:null}{item.extras?.length?<Text style={styles.merchantDetailItemMeta}>Agregados: {item.extras.join(", ")}</Text>:null}{item.note?<View style={styles.merchantKitchenNote}><Ionicons name="create-outline" size={16} color="#9a3e12"/><Text style={styles.merchantKitchenNoteText}>{item.note}</Text></View>:null}{canManage&&menuId?<Pressable disabled={busy||actionBusy||hasPending} style={[styles.merchantSubstitutionTrigger,(busy||actionBusy||hasPending)&&styles.disabledButton]} onPress={()=>{setSelectedItemId(menuId);setReplacementId("");setReason("");}}><Ionicons name={hasPending?"hourglass-outline":"swap-horizontal-outline"} size={17} color="#9a3e12"/><Text style={styles.merchantSubstitutionTriggerText}>{hasPending?"Esperando respuesta":"Gestionar faltante"}</Text></Pressable>:null}</View></View>})}</View>
          {selectedOrderItem&&selectedCatalogItem?<View style={styles.merchantSubstitutionComposer}><View><Text style={styles.merchantScreenEyebrow}>SUSTITUCIÓN</Text><Text style={styles.merchantDetailSectionTitle}>Reemplazar {selectedOrderItem.name}</Text><Text style={styles.cardText}>Se marcará sin stock sólo en {branch?.name||"la sucursal del pedido"}. El cliente recibirá una propuesta verificable.</Text></View>{!order.branchId?<View style={styles.merchantDetailError}><Ionicons name="alert-circle-outline" size={18} color="#a33b28"/><Text style={styles.merchantDetailErrorText}>El pedido no conserva una sucursal operable; no se permite modificar inventario.</Text></View>:null}{candidates.length?<><Text style={styles.issueFieldLabel}>Elegí un reemplazo disponible</Text><View style={styles.merchantReplacementList}>{candidates.map(item=><Pressable key={item.id} style={[styles.merchantReplacementOption,replacementId===item.id&&styles.merchantReplacementOptionActive]} onPress={()=>setReplacementId(item.id)}><View style={styles.merchantReplacementRadio}>{replacementId===item.id?<View style={styles.merchantReplacementRadioDot}/>:null}</View><View style={styles.merchantAccountCopy}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.cardText}>{item.category||"Sin categoría"} · {money.format(item.price)}</Text></View>{selectedCatalogItem.category&&item.category===selectedCatalogItem.category?<Text style={styles.merchantRecommendedBadge}>MISMA CATEGORÍA</Text>:null}</Pressable>)}</View><TextInput value={reason} onChangeText={setReason} maxLength={500} multiline numberOfLines={3} placeholder="Motivo para el cliente" style={[styles.input,styles.issueDescriptionInput]}/><Pressable disabled={!order.branchId||!replacementId||reason.trim().length<3||busy||actionBusy||selectedPending} style={[styles.issueSubmitButton,(!order.branchId||!replacementId||reason.trim().length<3||busy||actionBusy||selectedPending)&&styles.disabledButton]} onPress={()=>void submitSubstitution()}>{actionBusy?<ActivityIndicator size="small" color="#fff"/>:<Ionicons name="paper-plane-outline" size={18} color="#fff"/>}<Text style={styles.issueSubmitText}>{actionBusy?"Validando inventario…":"Marcar agotado y proponer"}</Text></Pressable></>:<View style={styles.merchantDetailError}><Ionicons name="alert-circle-outline" size={18} color="#a33b28"/><Text style={styles.merchantDetailErrorText}>No hay otro producto disponible de precio igual o menor en esta sucursal.</Text></View>}</View>:null}
          <View style={styles.merchantDetailSection}><View style={styles.merchantDetailSectionHeader}><Text style={styles.sectionTitle}>Cambios del pedido</Text>{loading?<ActivityIndicator size="small" color="#ef641f"/>:null}</View>{substitutions.map(entry=><View key={entry.id} style={styles.merchantSubstitutionHistory}><View style={[styles.merchantSubstitutionStatus,entry.status==="pending"?styles.merchantSubstitutionPending:entry.status==="accepted"?styles.merchantSubstitutionAccepted:styles.merchantSubstitutionRejected]}><Text style={styles.merchantSubstitutionStatusText}>{entry.status==="pending"?"PENDIENTE":entry.status==="accepted"?"ACEPTADO":"RECHAZADO"}</Text></View><Text style={styles.merchantDetailItemTitle}>{entry.original.name} → {entry.replacement.name}</Text><Text style={styles.cardText}>{entry.reason}</Text>{entry.refundAmount>0?<Text style={styles.merchantRefundText}>Reintegro aplicado: {money.format(entry.refundAmount)}</Text>:null}</View>)}{!loading&&!substitutions.length?<Text style={styles.muted}>Todavía no se propusieron cambios.</Text>:null}</View>
          {error?<View style={styles.merchantDetailError}><Ionicons name="alert-circle-outline" size={18} color="#a33b28"/><Text style={styles.merchantDetailErrorText}>{error}</Text></View>:null}
          <View style={styles.merchantDetailDelivery}><Ionicons name="location-outline" size={20} color="#7c3cff"/><View style={styles.merchantAccountCopy}><Text style={styles.merchantDetailItemTitle}>Destino de entrega</Text><Text style={styles.cardText}>{order.deliveryAddress}</Text></View></View>
          <Pressable style={styles.merchantDetailChat} onPress={()=>onOpenChat(order.id)}><Ionicons name="chatbubbles-outline" size={19} color="#fff"/><Text style={styles.issueSubmitText}>Abrir chat del pedido</Text></Pressable>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

function DriverScreen({
  state,
  driver,
  busy,
  runAction,
  onLogout,
  onRefresh,
}: {
  state: AppState;
  driver: Driver;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [driverView,setDriverView]=useState<"home"|"earnings"|"inbox"|"account">("home");
  const driverScrollRef=useRef<ScrollView>(null);
  const [navigationOpen,setNavigationOpen]=useState(false);
  const [driverNotifications,setDriverNotifications]=useState<AppNotification[]>([]);
  const [driverNotificationsLoading,setDriverNotificationsLoading]=useState(false);
  const [driverEarnings,setDriverEarnings]=useState<DriverEarnings|null>(null);
  const [driverEarningsLoading,setDriverEarningsLoading]=useState(false);
  const [driverEarningsError,setDriverEarningsError]=useState("");
  const [selectedDriverDay,setSelectedDriverDay]=useState<string|null>(null);
  const [driverDemand,setDriverDemand]=useState<DriverDemand|null>(null);
  const [driverDemandLoading,setDriverDemandLoading]=useState(false);
  const [driverDemandError,setDriverDemandError]=useState("");
  const [chatJobId,setChatJobId]=useState<string|null>(null);
  const [gpsStatus, setGpsStatus] = useState<
    "paused" | "requesting" | "live" | "denied"
  >("paused");
  const [backgroundGps,setBackgroundGps]=useState<BackgroundLocationState>("stopped");
  const [driverPoint, setDriverPoint] = useState<GeoPoint | null>(
    driver.location || null,
  );
  const [driverRoute, setDriverRoute] = useState<RoadRoute | null>(null);
  const [driverRouteError, setDriverRouteError] = useState("");
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [deliveryPins, setDeliveryPins] = useState<Record<string, string>>({});
  const [ridePickupPins,setRidePickupPins]=useState<Record<string,string>>({});
  const [deliveryEvidenceReady,setDeliveryEvidenceReady]=useState<Record<string,boolean>>({});
  const [deliverySignatureReady,setDeliverySignatureReady]=useState<Record<string,boolean>>({});
  const [deliveryEvidenceUploading,setDeliveryEvidenceUploading]=useState<string|null>(null);
  const [signatureShipmentId,setSignatureShipmentId]=useState<string|null>(null);
  const [compliance,setCompliance]=useState<DriverCompliance|null>(null);
  const [documentType,setDocumentType]=useState<DriverDocument["type"]>("identity");
  const [documentExpiry,setDocumentExpiry]=useState("2099-12-31");
  const [documentUploading,setDocumentUploading]=useState(false);
  const [vehicles,setVehicles]=useState<DriverVehicle[]>([]);
  const [vehicleBusy,setVehicleBusy]=useState(false);
  const [driverPreferences,setDriverPreferences]=useState<DriverPreferences>({driverId:driver.id,navigationProvider:"system",updatedAt:null});
  const [driverPreferenceBusy,setDriverPreferenceBusy]=useState(false);
  const [vehicleDraft,setVehicleDraft]=useState<{kind:DriverVehicle["kind"];model:string;plate:string;color:string;seats:string}>({kind:"car",model:"",plate:"",color:"",seats:"4"});

  useEffect(()=>{if(driverView!=="inbox")return;let cancelled=false;setDriverNotificationsLoading(true);void api.getNotifications().then(result=>{if(!cancelled)setDriverNotifications(result.notifications);}).catch(()=>{if(!cancelled)setDriverNotifications([]);}).finally(()=>{if(!cancelled)setDriverNotificationsLoading(false);});return()=>{cancelled=true;};},[driverView,driver.id]);
  useEffect(()=>{driverScrollRef.current?.scrollTo({y:0,animated:false});},[driverView]);

  const loadDriverEarnings=useCallback(async()=>{setDriverEarningsLoading(true);setDriverEarningsError("");try{setDriverEarnings((await api.getDriverEarnings()).earnings);}catch(error){setDriverEarningsError(error instanceof Error?error.message:"No se pudieron cargar las ganancias");}finally{setDriverEarningsLoading(false);}},[driver.id]);
  useEffect(()=>{if(driverView!=="earnings")return;void loadDriverEarnings();const poll=setInterval(()=>void loadDriverEarnings(),60000);return()=>clearInterval(poll);},[driverView,loadDriverEarnings]);

  const loadDriverDemand=useCallback(async()=>{setDriverDemandLoading(true);setDriverDemandError("");try{setDriverDemand((await api.getDriverDemand()).demand);}catch(error){setDriverDemandError(error instanceof Error?error.message:"No se pudo cargar la actividad por zonas");}finally{setDriverDemandLoading(false);}},[driver.id,driver.activeService]);
  useEffect(()=>{if(driverView!=="home")return;void loadDriverDemand();const poll=setInterval(()=>void loadDriverDemand(),60000);return()=>clearInterval(poll);},[driverView,loadDriverDemand]);

  const loadCompliance=useCallback(async()=>{try{setCompliance((await api.getDriverCompliance(driver.id)).compliance);}catch(_error){setCompliance(null);}},[driver.id]);
  const loadVehicles=useCallback(async()=>{try{setVehicles((await api.getDriverVehicles(driver.id)).vehicles);}catch(_error){setVehicles([]);}},[driver.id]);
  const loadDriverPreferences=useCallback(async()=>{try{setDriverPreferences((await api.getDriverPreferences()).preferences);}catch(_error){setDriverPreferences({driverId:driver.id,navigationProvider:"system",updatedAt:null});}},[driver.id]);
  useEffect(()=>{void loadCompliance();void loadVehicles();void loadDriverPreferences();},[loadCompliance,loadVehicles,loadDriverPreferences]);
  useEffect(()=>{void getBackgroundLocationState().then(setBackgroundGps);},[driver.online]);
  const addVehicle=async()=>{setVehicleBusy(true);try{const ride=["car","van"].includes(vehicleDraft.kind);await api.createDriverVehicle(driver.id,{kind:vehicleDraft.kind,model:vehicleDraft.model.trim(),plate:vehicleDraft.plate.trim(),color:vehicleDraft.color.trim()||null,seats:ride?Number(vehicleDraft.seats):1,serviceModes:ride?["delivery","ride"]:["delivery"]});setVehicleDraft({kind:"car",model:"",plate:"",color:"",seats:"4"});await loadVehicles();Alert.alert("Vehículo enviado","Operaciones debe verificarlo antes de que puedas conectarte.");}catch(error){Alert.alert("Flash",error instanceof Error?error.message:"No se pudo registrar el vehículo");}finally{setVehicleBusy(false);}};
  const runVehicleAction=async(action:()=>Promise<unknown>,message:string)=>{setVehicleBusy(true);try{await action();await loadVehicles();Alert.alert("Flash",message);}catch(error){Alert.alert("Flash",error instanceof Error?error.message:"No se pudo actualizar el vehículo");}finally{setVehicleBusy(false);}};
  const pickComplianceDocument=async()=>{const result=await DocumentPicker.getDocumentAsync({type:["image/jpeg","image/png","application/pdf"],copyToCacheDirectory:true,multiple:false});if(result.canceled)return;const asset=result.assets[0];if((asset.size||0)>750000){Alert.alert("Documento demasiado grande","El máximo seguro es 750 KB.");return;}const mimeType=(asset.mimeType||"application/pdf") as "image/jpeg"|"image/png"|"application/pdf";setDocumentUploading(true);try{const contentBase64=await FileSystem.readAsStringAsync(asset.uri,{encoding:FileSystem.EncodingType.Base64});await api.submitDriverDocument(driver.id,{type:documentType,mimeType,contentBase64,expiresAt:["driver_license","vehicle_registration","insurance"].includes(documentType)?documentExpiry:null});await loadCompliance();Alert.alert("Flash","Documento cifrado y enviado a revisión");}catch(error){Alert.alert("Flash",error instanceof Error?error.message:"No se pudo subir el documento");}finally{setDocumentUploading(false);}};
  const captureDeliveryEvidence=async(shipmentId:string)=>{const permission=await ImagePicker.requestCameraPermissionsAsync();if(!permission.granted){Alert.alert("Permiso necesario","Habilitá la cámara para registrar la entrega.");return;}const result=await ImagePicker.launchCameraAsync({mediaTypes:["images"],allowsEditing:false,quality:.55,base64:true,exif:false});if(result.canceled)return;const asset=result.assets[0];if(!asset.base64){Alert.alert("Flash","La cámara no devolvió una imagen válida.");return;}setDeliveryEvidenceUploading(shipmentId);try{let location=driverPoint||undefined;if(!location){const current=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}).catch(()=>null);if(current)location={lat:current.coords.latitude,lng:current.coords.longitude};}await api.addShipmentDeliveryEvidence(shipmentId,{type:"photo",mimeType:(asset.mimeType||"image/jpeg") as "image/jpeg"|"image/png"|"image/webp",contentBase64:asset.base64,capturedAt:new Date().toISOString(),location});setDeliveryEvidenceReady(current=>({...current,[shipmentId]:true}));Alert.alert("Evidencia protegida","La foto quedó cifrada y vinculada al envío. Ahora pedí el PIN.");}catch(error){Alert.alert("Flash",error instanceof Error?error.message:"No se pudo guardar la evidencia");}finally{setDeliveryEvidenceUploading(null);}};
  const saveDeliverySignature=async(input:{contentBase64:string;signerName:string;signerRelationship:"recipient"|"authorized_person"})=>{if(!signatureShipmentId)return;const shipmentId=signatureShipmentId;setDeliveryEvidenceUploading(shipmentId);try{let location=driverPoint||undefined;if(!location){const current=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}).catch(()=>null);if(current)location={lat:current.coords.latitude,lng:current.coords.longitude};}await api.addShipmentDeliveryEvidence(shipmentId,{type:"signature",mimeType:"image/png",contentBase64:input.contentBase64,capturedAt:new Date().toISOString(),location,signerName:input.signerName,signerRelationship:input.signerRelationship,consentVersion:"shipment-receipt-v1"});setDeliverySignatureReady(current=>({...current,[shipmentId]:true}));setSignatureShipmentId(null);Alert.alert("Firma protegida","La recepción quedó cifrada y vinculada al envío.");}catch(error){Alert.alert("Flash",error instanceof Error?error.message:"No se pudo guardar la firma");}finally{setDeliveryEvidenceUploading(null);}};

  const loadOffers = useCallback(async () => {
    if (!driver.online) {
      setOffers([]);
      return;
    }
    setOffersLoading(true);
    try {
      setOffers((await api.getDriverOffers()).offers);
    } catch (_error) {
      setOffers([]);
    } finally {
      setOffersLoading(false);
    }
  }, [driver.online]);
  useEffect(() => {
    void loadOffers();
    const poll = setInterval(() => void loadOffers(), 5000),
      ticker = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [loadOffers]);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let disposed = false;

    const startLocationTracking = async () => {
      if (!driver.online) {
        setGpsStatus("paused");
        return;
      }
      setGpsStatus("requesting");
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setGpsStatus("denied");
        return;
      }
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 50,
        },
        ({ coords }) => {
          if (disposed) return;
          const nextPoint = { lat: coords.latitude, lng: coords.longitude };
          setDriverPoint(nextPoint);
          void api
            .updateDriverLocation(driver.id, {
              ...nextPoint,
              label: "Ubicacion GPS",
              source:"foreground",
              accuracyM:coords.accuracy??undefined,
            })
            .then(() => setGpsStatus("live"))
            .catch(() => setGpsStatus("denied"));
        },
      );
    };

    void startLocationTracking().catch(() => setGpsStatus("denied"));
    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [driver.id, driver.online]);

  const activeOrders = state.orders.filter(
    (order) =>
      order.courierId === driver.id &&
      !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) =>
      ride.driverId === driver.id &&
      !["completed", "cancelled"].includes(ride.status),
  );
  const activeShipments = state.shipments.filter(
    (shipment) =>
      shipment.driverId === driver.id &&
      !["delivered", "cancelled"].includes(shipment.status),
  );
  const visibleOffers = offers.filter((offer) =>
    driver.activeService === "ride"
      ? offer.kind === "ride"
      : offer.kind === "delivery",
  );
  const navigationTarget=useMemo<DriverNavigationTarget|null>(()=>{const ride=activeRides[0];if(ride){const toPickup=ride.status!=="in_progress";return{id:ride.id,kind:"Viaje",phase:toPickup?"Buscar pasajero":"Llevar pasajero",point:toPickup?ride.pickupLocation:ride.destinationLocation,address:toPickup?ride.pickup:ride.destination};}const order=activeOrders[0];if(order){const toPickup=!['picked_up','delivering'].includes(order.status);return{id:order.id,kind:"Comida",phase:toPickup?"Ir al comercio":"Entregar pedido",point:toPickup?order.pickupLocation:order.deliveryLocation,address:toPickup?"Punto de retiro":order.deliveryAddress};}const shipment=activeShipments[0];if(shipment){const toPickup=!['picked_up','delivering'].includes(shipment.status);return{id:shipment.id,kind:"Envío",phase:toPickup?"Retirar paquete":"Entregar paquete",point:toPickup?shipment.pickupLocation:shipment.destinationLocation,address:toPickup?shipment.pickup:shipment.destination};}return null;},[activeRides,activeOrders,activeShipments]);
  const activeVehicle=vehicles.find(vehicle=>vehicle.active&&vehicle.status==="approved")||null;
  const navigationTravelMode=activeVehicle?.kind==="bicycle"?"bicycling":"driving";
  const openExternalNavigation=async()=>{const point=navigationTarget?.point;if(!point)return;const url=buildExternalNavigationUrl(Platform.OS,point,navigationTravelMode,driverPreferences.navigationProvider);if(!url)return;try{await Linking.openURL(url);}catch(_error){Alert.alert("Navegación no disponible","No pudimos abrir la aplicación de mapas de este dispositivo.");}};
  useEffect(()=>{if(!navigationTarget)setNavigationOpen(false);},[navigationTarget?.id]);

  const notificationTitles:Record<string,string>={order_status:"Actualización de entrega",ride_status:"Actualización de viaje",shipment_status:"Actualización de envío",tip_received:"Recibiste una propina",support_reply:"Nueva respuesta de soporte",support_ticket_created:"Caso de soporte creado",driver_document_status:"Estado de documento",driver_vehicle_status:"Estado de vehículo"};
  const activeChats=[...activeOrders.map(order=>({id:order.id,label:"Pedido de comida",detail:order.deliveryAddress,icon:"restaurant" as const})),...activeRides.map(ride=>({id:ride.id,label:"Viaje con pasajero",detail:ride.destination,icon:"car-sport" as const})),...activeShipments.map(shipment=>({id:shipment.id,label:"Envío activo",detail:shipment.destination,icon:"cube" as const}))];

  useEffect(() => {
    if (!driverPoint || !navigationTarget?.point) {
      setDriverRoute(null);
      setDriverRouteError("");
      return;
    }
    let cancelled = false;
    setDriverRoute(null);
    setDriverRouteError("");
    void api
      .route(driverPoint, navigationTarget.point)
      .then((response) => {
        if (!cancelled) setDriverRoute(response.route);
      })
      .catch(() => {if(!cancelled)setDriverRouteError("No pudimos actualizar la ruta. Conservá el destino y reintentá con conexión.");});
    return () => {
      cancelled = true;
    };
  }, [driverPoint?.lat, driverPoint?.lng, navigationTarget?.id,navigationTarget?.phase]);

  const onlineToday=driverEarnings?.today.onlineSeconds;
  const activeToday=driverEarnings?.today.activeSeconds;
  const operationalRatio=onlineToday!=null&&activeToday!=null&&onlineToday>0&&activeToday<=onlineToday?Math.round(activeToday/onlineToday*100):null;
  const operationalAnomaly=onlineToday!=null&&activeToday!=null&&activeToday>onlineToday;
  const driverWeekMagnitude=Math.max(1,...(driverEarnings?.days||[]).map(day=>Math.abs(day.amount)));
  const driverSelectedDay=driverEarnings?.days.find(day=>day.date===selectedDriverDay)||driverEarnings?.days.at(-1)||null;

  return (
    <View style={styles.driverShell}>
      <SignatureCaptureModal visible={Boolean(signatureShipmentId)} onClose={()=>{if(!deliveryEvidenceUploading)setSignatureShipmentId(null);}} onSave={saveDeliverySignature} busy={Boolean(deliveryEvidenceUploading)}/>
      <ServiceChatModal jobId={chatJobId} currentUserId={driver.userId} onClose={()=>setChatJobId(null)}/>
      <DriverNavigationModal visible={navigationOpen} target={navigationTarget} origin={driverPoint} route={driverRoute} routeError={driverRouteError} vehicleIcon={activeVehicle?.kind==="bicycle"?"bicycle":"car-sport"} onExternal={()=>void openExternalNavigation()} onChat={()=>{setNavigationOpen(false);if(navigationTarget)setChatJobId(navigationTarget.id);}} onClose={()=>setNavigationOpen(false)}/>
      <ScrollView ref={driverScrollRef} contentContainerStyle={styles.driverContent} refreshControl={<RefreshControl refreshing={busy} onRefresh={async()=>{await Promise.all([onRefresh(),loadDriverDemand(),loadOffers()]);}}/>} showsVerticalScrollIndicator={false}>
      <View style={styles.driverAppHeader}><View><Text style={styles.driverBrand}>FLASH DRIVER</Text><Text style={styles.driverGreeting}>{driverView==="home"?"Tu jornada":driverView==="earnings"?"Ganancias":driverView==="inbox"?"Inbox":"Cuenta"}</Text></View><Pressable style={styles.driverHeaderAction} onPress={()=>void onLogout()} accessibilityRole="button" accessibilityLabel="Cerrar sesión"><Ionicons name="log-out-outline" size={22} color="#17131c"/></Pressable></View>
      {driverView==="account"&&<>
      <View style={styles.complianceCard}><View style={styles.complianceHeader}><View><Text style={styles.heroLabel}>NAVEGACIÓN</Text><Text style={styles.sectionTitle}>Guía externa preferida</Text></View><View style={styles.driverInsightIcon}><Ionicons name="navigate-outline" size={22} color="#7c3cff"/></View></View><Text style={styles.cardText}>Flash conserva etapa y trabajo activo. Esta preferencia sólo decide qué app abre el botón de guía completa.</Text><View style={styles.driverPreferenceOptions}>{([['system','Predeterminada','Usa Apple Maps en iPhone y Google Maps en el resto'],['google_maps','Google Maps','Mantiene conducción o bicicleta según tu vehículo'],...(Platform.OS==='ios'?[['apple_maps','Apple Maps','Disponible para conducción en iPhone']]:[])] as Array<[DriverPreferences['navigationProvider'],string,string]>).map(([value,label,detail])=><Pressable key={value} disabled={driverPreferenceBusy} accessibilityRole="radio" accessibilityState={{checked:driverPreferences.navigationProvider===value}} onPress={async()=>{setDriverPreferenceBusy(true);try{setDriverPreferences((await api.updateDriverPreferences(value)).preferences);}catch(error){Alert.alert("Flash",error instanceof Error?error.message:"No se pudo guardar la preferencia");}finally{setDriverPreferenceBusy(false);}}} style={[styles.driverPreferenceOption,driverPreferences.navigationProvider===value&&styles.driverPreferenceOptionActive]}><View style={[styles.driverPreferenceRadio,driverPreferences.navigationProvider===value&&styles.driverPreferenceRadioActive]}>{driverPreferences.navigationProvider===value?<View style={styles.driverPreferenceDot}/>:null}</View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{label}</Text><Text style={styles.cardText}>{detail}</Text></View></Pressable>)}</View><Text style={styles.notificationTime}>{driverPreferences.updatedAt?`Guardado ${new Date(driverPreferences.updatedAt).toLocaleString("es-AR")}`:"Preferencia predeterminada"}</Text></View>
      <View style={styles.complianceCard}><View style={styles.complianceHeader}><View><Text style={styles.heroLabel}>LEGAJO Y SEGURIDAD</Text><Text style={styles.sectionTitle}>Verificación del conductor</Text></View><Text style={[styles.complianceBadge,compliance?.status==="approved"&&styles.complianceBadgeApproved,compliance?.status==="rejected"&&styles.complianceBadgeRejected]}>{(compliance?.status||"cargando").replaceAll("_"," ").toUpperCase()}</Text></View><Text style={styles.cardText}>Los archivos se cifran antes de persistir y sólo operaciones puede aprobarlos.</Text><View style={styles.complianceDocuments}>{compliance?.requiredTypes.map(type=>{const current=compliance.documents.find(document=>document.type===type&&!["superseded"].includes(document.status));const labels={identity:"Identidad",driver_license:"Licencia",vehicle_registration:"Cédula del vehículo",insurance:"Seguro",background_check:"Antecedentes"};return <View style={styles.complianceDocumentRow} key={type}><Ionicons name={current?.status==="approved"?"checkmark-circle":current?.status==="rejected"?"close-circle":"document-text-outline"} size={20} color={current?.status==="approved"?"#087a50":current?.status==="rejected"?"#c43d38":"#7c3cff"}/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{labels[type]}</Text><Text style={styles.cardText}>{current?current.status.replaceAll("_"," "):"Pendiente de envío"}{current?.expiresAt?` · vence ${current.expiresAt}`:""}</Text>{current?.rejectionReason&&<Text style={styles.complianceRejection}>{current.rejectionReason}</Text>}</View></View>})}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{([['identity','Identidad'],['driver_license','Licencia'],['vehicle_registration','Cédula'],['insurance','Seguro'],['background_check','Antecedentes']] as const).map(([value,label])=><Pressable key={value} onPress={()=>setDocumentType(value)} style={[styles.issueCategoryPill,documentType===value&&styles.issueCategoryPillActive]}><Text style={[styles.issueCategoryText,documentType===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView>{["driver_license","vehicle_registration","insurance"].includes(documentType)&&<TextInput style={styles.input} value={documentExpiry} onChangeText={setDocumentExpiry} placeholder="Vencimiento AAAA-MM-DD"/>}<Pressable disabled={documentUploading} style={[styles.primaryButton,documentUploading&&styles.disabledButton]} onPress={pickComplianceDocument}><Ionicons name="cloud-upload-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>{documentUploading?"Cifrando y enviando…":"Elegir PDF o imagen"}</Text></Pressable></View>
      <View style={styles.complianceCard}><View style={styles.complianceHeader}><View><Text style={styles.heroLabel}>FLOTA PERSONAL</Text><Text style={styles.sectionTitle}>Vehículo operativo</Text></View><Text style={styles.complianceBadge}>{vehicles.length}/5</Text></View><Text style={styles.cardText}>Sólo el vehículo activo, aprobado y compatible recibe ofertas. Un cambio vuelve a revisión y te desconecta.</Text>{vehicles.map(vehicle=><View key={vehicle.id} style={styles.complianceDocumentRow}><Ionicons name={vehicle.kind==="bicycle"?"bicycle":vehicle.kind==="motorcycle"?"speedometer-outline":"car-sport-outline"} size={22} color={vehicle.active?"#7c3cff":"#777"}/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{vehicle.model} · {vehicle.plate}</Text><Text style={styles.cardText}>{vehicle.kind} · {vehicle.serviceModes.join(" + ")} · {vehicle.status}{vehicle.active?" · activo":""}</Text>{vehicle.rejectionReason&&<Text style={styles.complianceRejection}>{vehicle.rejectionReason}</Text>}</View>{!vehicle.active&&vehicle.status==="approved"?<Pressable disabled={vehicleBusy} onPress={()=>void runVehicleAction(()=>api.activateDriverVehicle(vehicle.id),"Vehículo activado; revisá tu disponibilidad.")}><Ionicons name="checkmark-circle-outline" size={25} color="#087a50"/></Pressable>:null}<Pressable disabled={vehicleBusy} onPress={()=>Alert.alert("Retirar vehículo",`¿Retirar ${vehicle.model}? La evidencia histórica se conservará.`,[{text:"Cancelar",style:"cancel"},{text:"Retirar",style:"destructive",onPress:()=>void runVehicleAction(()=>api.retireDriverVehicle(vehicle.id),"Vehículo retirado") }])}><Ionicons name="trash-outline" size={21} color="#a33939"/></Pressable></View>)}<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{([['bicycle','Bici'],['motorcycle','Moto'],['car','Auto'],['van','Van']] as const).map(([value,label])=><Pressable key={value} onPress={()=>setVehicleDraft(current=>({...current,kind:value,seats:["car","van"].includes(value)?current.seats||"4":"1"}))} style={[styles.issueCategoryPill,vehicleDraft.kind===value&&styles.issueCategoryPillActive]}><Text style={[styles.issueCategoryText,vehicleDraft.kind===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView><TextInput style={styles.input} value={vehicleDraft.model} onChangeText={model=>setVehicleDraft(current=>({...current,model}))} placeholder="Marca y modelo"/><TextInput style={styles.input} value={vehicleDraft.plate} onChangeText={plate=>setVehicleDraft(current=>({...current,plate:plate.toUpperCase()}))} autoCapitalize="characters" placeholder="Patente"/><TextInput style={styles.input} value={vehicleDraft.color} onChangeText={color=>setVehicleDraft(current=>({...current,color}))} placeholder="Color"/>{["car","van"].includes(vehicleDraft.kind)?<TextInput style={styles.input} value={vehicleDraft.seats} onChangeText={seats=>setVehicleDraft(current=>({...current,seats:seats.replace(/\D/g,"").slice(0,1)}))} keyboardType="numeric" placeholder="Asientos"/>:null}<Pressable disabled={vehicleBusy||!vehicleDraft.model.trim()||vehicleDraft.plate.trim().length<3} style={[styles.primaryButton,(vehicleBusy||!vehicleDraft.model.trim()||vehicleDraft.plate.trim().length<3)&&styles.disabledButton]} onPress={()=>void addVehicle()}><Ionicons name="add-circle-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>{vehicleBusy?"Guardando…":"Registrar vehículo"}</Text></Pressable></View>
      </>}
      {driverView==="earnings"&&<>
        <LinearGradient colors={["#21132f","#6f25d8"]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.driverEarningsHero}><Text style={styles.driverEarningsLabel}>INGRESOS REGISTRADOS HOY</Text><Text style={styles.driverEarningsValue}>{money.format(driverEarnings?.today.amount??driver.earningsToday)}</Text><Text style={styles.driverEarningsCopy}>{driverEarnings?.source==="postgres-ledger"?"Calculado desde asientos contables posteados. Incluye servicios, propinas y ajustes reales.":"Runtime local de prueba: los importes provienen de movimientos persistidos, sin proyecciones."}</Text></LinearGradient>
        {driverEarningsLoading&&!driverEarnings?<ActivityIndicator color="#7c3cff"/>:null}
        {driverEarningsError?<Pressable style={styles.driverEarningsError} onPress={()=>void loadDriverEarnings()}><Ionicons name="refresh-circle-outline" size={23} color="#a33939"/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>No pudimos leer el ledger</Text><Text style={styles.cardText}>{driverEarningsError} · Tocá para reintentar.</Text></View></Pressable>:null}
        <View style={styles.driverPeriodGrid}>
          <View style={styles.driverPeriodCard}><Text style={styles.driverPeriodLabel}>ESTA SEMANA</Text><Text style={styles.driverPeriodValue}>{money.format(driverEarnings?.week.amount??0)}</Text><Text style={styles.driverPeriodMeta}>{driverEarnings?.week.services??0} servicios</Text></View>
          <View style={styles.driverPeriodCard}><Text style={styles.driverPeriodLabel}>SALDO WALLET</Text><Text style={styles.driverPeriodValue}>{money.format(driverEarnings?.walletBalance??0)}</Text><Text style={styles.driverPeriodMeta}>retiro aún no habilitado</Text></View>
        </View>
        {driverEarnings?.days.length?<View style={styles.driverWeekChartCard}>
          <View style={styles.driverSectionHeading}><View><Text style={styles.driverSectionEyebrow}>SEMANA EN CURSO</Text><Text style={styles.driverTimeTitle}>Ingresos por día</Text></View><Text style={styles.driverWeekChartTotal}>{money.format(driverEarnings.week.amount)}</Text></View>
          <View style={styles.driverWeekChart} accessibilityRole="summary" accessibilityLabel={`Ingresos de la semana ${money.format(driverEarnings.week.amount)}`}>
            {driverEarnings.days.map(day=>{const height=Math.max(day.amount===0?3:8,Math.round(Math.abs(day.amount)/driverWeekMagnitude*52));const weekday=new Date(`${day.date}T12:00:00`).toLocaleDateString("es-AR",{weekday:"short"}).replace(".","").toUpperCase();const selected=driverSelectedDay?.date===day.date;return <Pressable key={day.date} onPress={()=>setSelectedDriverDay(day.date)} style={[styles.driverWeekColumn,selected&&styles.driverWeekColumnSelected]} accessibilityRole="button" accessibilityState={{selected}} accessibilityLabel={`${weekday}: ${money.format(day.amount)}, ${day.services} servicios`}><Text style={[styles.driverWeekAmount,day.amount<0&&styles.driverWeekAmountNegative]}>{compactMoney(day.amount)}</Text><View style={styles.driverWeekUpper}>{day.amount>=0?<View style={[styles.driverWeekBar,{height,backgroundColor:day.amount===0?"#d9d2dd":"#7c3cff"}]}/>:null}</View><View style={styles.driverWeekBaseline}/><View style={styles.driverWeekLower}>{day.amount<0?<View style={[styles.driverWeekBar,{height,backgroundColor:"#c44a45"}]}/>:null}</View><Text style={[styles.driverWeekDay,selected&&styles.driverWeekDaySelected]}>{weekday}</Text></Pressable>})}
          </View>
          {driverSelectedDay?<View style={styles.driverWeekDetail}><View style={styles.driverWeekDetailHeader}><View><Text style={styles.driverTimeLabel}>DETALLE SELECCIONADO</Text><Text style={styles.driverWeekDetailDate}>{new Date(`${driverSelectedDay.date}T12:00:00`).toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"})}</Text></View><Text style={[styles.driverWeekDetailAmount,driverSelectedDay.amount<0&&styles.driverWeekAmountNegative]}>{money.format(driverSelectedDay.amount)}</Text></View><View style={styles.driverWeekDetailGrid}><View style={styles.driverWeekDetailMetric}><Text style={styles.driverTimeMeta}>Servicios</Text><Text style={styles.driverWeekDetailValue}>{driverSelectedDay.services}</Text></View><View style={styles.driverWeekDetailMetric}><Text style={styles.driverTimeMeta}>Propinas</Text><Text style={styles.driverWeekDetailValue}>{money.format(driverSelectedDay.tips)}</Text></View><View style={styles.driverWeekDetailMetric}><Text style={styles.driverTimeMeta}>Conectado</Text><Text style={styles.driverWeekDetailValue}>{operationalDuration(driverSelectedDay.onlineSeconds)}</Text></View><View style={styles.driverWeekDetailMetric}><Text style={styles.driverTimeMeta}>En servicio</Text><Text style={styles.driverWeekDetailValue}>{operationalDuration(driverSelectedDay.activeSeconds)}</Text></View></View></View>:null}
          <Text style={styles.driverTimeSource}>Neto diario posteado: servicios, propinas y ajustes. Los días vacíos son cero, no una proyección.</Text>
        </View>:null}
        {driverEarnings?.timeTracking.status==="available"?<View style={styles.driverTimeCard}>
          <View style={styles.driverSectionHeading}><View><Text style={styles.driverSectionEyebrow}>JORNADA OBSERVADA</Text><Text style={styles.driverTimeTitle}>Tu tiempo de hoy</Text></View><View style={styles.driverTimeClock}><Ionicons name="time-outline" size={22} color="#7c3cff"/></View></View>
          <View style={styles.driverTimeGrid}>
            <View style={styles.driverTimeMetric}><View style={styles.driverTimeMetricTop}><View style={[styles.driverTimeDot,{backgroundColor:"#7c3cff"}]}/><Text style={styles.driverTimeLabel}>CONECTADO</Text></View><Text style={styles.driverTimeValue}>{operationalDuration(onlineToday)}</Text><Text style={styles.driverTimeMeta}>incluye espera online</Text></View>
            <View style={styles.driverTimeMetric}><View style={styles.driverTimeMetricTop}><View style={[styles.driverTimeDot,{backgroundColor:"#087a50"}]}/><Text style={styles.driverTimeLabel}>EN SERVICIO</Text></View><Text style={styles.driverTimeValue}>{operationalDuration(activeToday)}</Text><Text style={styles.driverTimeMeta}>asignación a cierre</Text></View>
          </View>
          {operationalRatio!=null?<View style={styles.driverTimeRatio}><View style={styles.driverTimeTrack}><View style={[styles.driverTimeFill,{width:`${operationalRatio}%`}]}/></View><Text style={styles.driverTimeRatioText}>{operationalRatio}% de la jornada conectada estuvo en servicio</Text></View>:null}
          {operationalAnomaly?<View style={styles.driverTimeWarning}><Ionicons name="alert-circle-outline" size={18} color="#9b5b00"/><Text style={styles.driverTimeWarningText}>Hay tiempo asignado fuera de una sesión online. El registro se conserva para revisión operativa.</Text></View>:null}
          <View style={styles.driverTimeWeek}><Text style={styles.driverTimeWeekLabel}>SEMANA</Text><Text style={styles.driverTimeWeekValue}>{operationalDuration(driverEarnings.week.onlineSeconds)} conectado</Text><View style={styles.driverTimeWeekDivider}/><Text style={styles.driverTimeWeekValue}>{operationalDuration(driverEarnings.week.activeSeconds)} en servicio</Text></View>
          <Text style={styles.driverTimeSource}>PostgreSQL · actualizado {new Date(driverEarnings.timeTracking.observedAt).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})} · los solapamientos cuentan una sola vez</Text>
        </View>:driverEarnings?<View style={styles.driverTimeUnavailable}><Ionicons name="cloud-offline-outline" size={21} color="#a33939"/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>Jornada no disponible</Text><Text style={styles.cardText}>Este runtime no tiene sesiones PostgreSQL. No mostramos horas aproximadas.</Text></View></View>:null}
        <KpiRow items={[["Servicios",driverEarnings?.today.services??0],["Propinas",money.format(driverEarnings?.today.tips??0)],["Ajustes",money.format(driverEarnings?.today.adjustments??0)],["Rating",driver.rating]]}/>
        <View style={styles.complianceCard}><View style={styles.driverSectionHeading}><View><Text style={styles.driverSectionEyebrow}>MOVIMIENTOS CONTABLES</Text><Text style={styles.sectionTitle}>Detalle reciente</Text></View><Pressable onPress={()=>void loadDriverEarnings()} accessibilityRole="button" accessibilityLabel="Actualizar ganancias"><Ionicons name="refresh-outline" size={21} color="#7c3cff"/></Pressable></View>{driverEarnings?.recent.length?driverEarnings.recent.map(entry=><View key={entry.id} style={styles.driverEarningRow}><View style={[styles.driverInboxIcon,entry.amount<0&&styles.driverEarningAdjustment]}><Ionicons name={entry.category==="tip"?"heart-outline":entry.category==="adjustment"?"remove-circle-outline":entry.category==="ride"?"car-sport-outline":entry.category==="shipment"?"cube-outline":"bag-handle-outline"} size={20} color={entry.amount<0?"#a33939":"#7c3cff"}/></View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{entry.description}</Text><Text style={styles.cardText}>{entry.jobId||"Movimiento de cuenta"} · {new Date(entry.createdAt).toLocaleString("es-AR")}</Text></View><Text style={[styles.driverEarningAmount,entry.amount<0&&styles.driverEarningAmountNegative]}>{entry.amount>0?"+":""}{money.format(entry.amount)}</Text></View>):<View style={styles.driverEmptyState}><Ionicons name="receipt-outline" size={34} color="#7c3cff"/><Text style={styles.sectionTitle}>Sin movimientos todavía</Text><Text style={styles.cardText}>Los servicios completados, propinas y ajustes aparecerán al postearse en el ledger.</Text></View>}</View>
        <View style={styles.driverTransparencyCard}><Ionicons name="shield-checkmark-outline" size={22} color="#087a50"/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>Datos honestos</Text><Text style={styles.cardText}>Ingresos y jornada provienen del ledger y de sesiones operativas. Metas, promociones y retiros siguen ocultos hasta tener contratos productivos.</Text></View></View>
      </>}
      {driverView==="inbox"&&<>
        <View style={styles.driverSectionHeading}><View><Text style={styles.driverSectionEyebrow}>COMUNICACIONES</Text><Text style={styles.driverSectionTitle}>Inbox</Text></View><View style={styles.driverUnreadBadge}><Text style={styles.driverUnreadText}>{driverNotifications.filter(item=>!item.readAt).length}</Text></View></View>
        {activeChats.length>0?<View style={styles.complianceCard}><Text style={styles.sectionTitle}>Chats de trabajos activos</Text><Text style={styles.cardText}>El chat queda ligado al servicio y conserva participantes autorizados.</Text>{activeChats.map(chat=><Pressable key={chat.id} style={styles.driverInboxRow} onPress={()=>setChatJobId(chat.id)}><View style={styles.driverInboxIcon}><Ionicons name={chat.icon} size={20} color="#7c3cff"/></View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{chat.label}</Text><Text style={styles.cardText} numberOfLines={1}>{chat.detail}</Text></View><Ionicons name="chevron-forward" size={19} color="#968c9e"/></Pressable>)}</View>:null}
        <View style={styles.complianceCard}><Text style={styles.sectionTitle}>Novedades de tu cuenta</Text>{driverNotificationsLoading?<ActivityIndicator color="#7c3cff"/>:driverNotifications.length===0?<View style={styles.driverEmptyState}><Ionicons name="mail-open-outline" size={34} color="#7c3cff"/><Text style={styles.sectionTitle}>Todo al día</Text><Text style={styles.cardText}>Los estados de servicios, documentos y soporte aparecerán acá.</Text></View>:driverNotifications.slice(0,20).map(item=><Pressable key={item.id} disabled={Boolean(item.readAt)} onPress={async()=>{const result=await api.markNotificationRead(item.id);setDriverNotifications(result.notifications);}} style={[styles.driverInboxRow,!item.readAt&&styles.driverInboxUnread]}><View style={styles.driverInboxIcon}><Ionicons name={item.readAt?"mail-open-outline":"mail-unread-outline"} size={20} color={item.readAt?"#777":"#7c3cff"}/></View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{notificationTitles[item.template]||"Novedad de Flash"}</Text><Text style={styles.cardText}>{String(item.payload.status||item.payload.kind||"Revisá el detalle de tu cuenta")}</Text><Text style={styles.notificationTime}>{new Date(item.createdAt).toLocaleString("es-AR")}</Text></View>{!item.readAt?<Text style={styles.notificationNew}>NUEVA</Text>:null}</Pressable>)}</View>
      </>}
      {driverView==="home"&&<>
      <View style={styles.actionRow}>
        <ActionButton
          label={driver.online ? "Pausar" : "Activar"}
          disabled={busy}
          onPress={() =>
            runAction(
              async () => {if(driver.online){await api.updateDriver(driver.id,{online:false});setBackgroundGps(await stopDriverBackgroundLocation());}else{await api.updateDriver(driver.id,{online:true});const tracking=await startDriverBackgroundLocation();setBackgroundGps(tracking);if(tracking!=="active")Alert.alert("Ubicación limitada",tracking==="foreground_only"?"Seguirás online, pero esta instalación sólo enviará GPS mientras la app esté abierta. Para background usá un development build y habilitá el permiso Siempre.":"Habilitá ubicación para recibir ofertas y compartir seguimiento.");}},
              "Disponibilidad actualizada",
            )
          }
        />
        <ActionButton
          label={
            driver.activeService === "delivery" ? "Modo taxi" : "Modo delivery"
          }
          disabled={busy}
          onPress={() =>
            runAction(
              () =>
                api.updateDriver(driver.id, {
                  activeService:
                    driver.activeService === "delivery" ? "ride" : "delivery",
                }),
              "Modo actualizado",
            )
          }
        />
      </View>
      <View style={styles.driverSectionHeading}><View><Text style={styles.driverSectionEyebrow}>{navigationTarget?"SERVICIO EN CURSO":"ACTIVIDAD OBSERVADA"}</Text><Text style={styles.sectionTitle}>{navigationTarget?"Trabajo activo":"Demanda por zonas"}</Text></View>{!navigationTarget?<Pressable onPress={()=>void loadDriverDemand()} disabled={driverDemandLoading} accessibilityRole="button" accessibilityLabel="Actualizar demanda por zonas"><Ionicons name="refresh-outline" size={21} color="#7c3cff"/></Pressable>:null}</View>
      {navigationTarget ? (
        driverPoint && navigationTarget.point ? (
          <FlashNativeMap
            origin={driverPoint}
            destination={navigationTarget.point}
            route={driverRoute?.coordinates || []}
            originRole="driver"
            driverIcon={activeVehicle?.kind === "bicycle" ? "bicycle" : "car-sport"}
            routeColor={navigationTarget.kind === "Comida" ? "#ff6a21" : navigationTarget.kind === "Envío" ? "#087a50" : "#7c3cff"}
            caption={`${navigationTarget.kind} · ${navigationTarget.phase}`}
            detail={driverRoute ? `${driverRoute.distanceKm} km · ${driverRoute.durationMin} min` : driverRouteError || "Calculando recorrido vial…"}
            height={270}
            accessibilityLabel="Mapa interactivo de navegación del conductor"
          />
        ) : (
          <NativeMapUnavailable message={driverPoint ? "El servicio todavía no tiene un punto geográfico verificable." : "Activá el GPS para calcular el recorrido al próximo punto."} height={270} />
        )
      ) : driverDemandLoading&&!driverDemand ? <View style={styles.driverDemandLoading}><ActivityIndicator color="#7c3cff"/><Text style={styles.cardText}>Consultando trabajos y oferta elegible en PostgreSQL…</Text></View> : driverDemand?.zones.length ? <>
        <DriverDemandMap zones={driverDemand.zones} driver={driverPoint} caption={`${driverDemand.city.name} · ${driver.activeService==="delivery"?"Delivery":"Viajes"}`} detail={`Observado ${new Date(driverDemand.observedAt).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}`} accessibilityLabel="Mapa nativo de demanda agregada para conductores"/>
        {driverDemandError?<Pressable style={styles.driverDemandError} onPress={()=>void loadDriverDemand()}><Ionicons name="cloud-offline-outline" size={20} color="#a33939"/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>Snapshot sin actualizar</Text><Text style={styles.cardText}>{driverDemandError} · Conservamos la hora visible del último dato.</Text></View></Pressable>:null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.driverDemandRail}>{driverDemand.zones.map(zone=>{const color=zone.level==="high"?"#ce263b":zone.level==="medium"?"#e66d13":"#857b8b";return <View key={zone.id} style={[styles.driverDemandCard,zone.containsDriver&&styles.driverDemandCardCurrent]}><View style={styles.driverDemandCardTop}><View style={[styles.driverDemandLevelDot,{backgroundColor:color}]}/><Text style={[styles.driverDemandLevel,{color}]}>{zone.level==="high"?"ALTA":zone.level==="medium"?"MEDIA":"SIN PEDIDOS"}</Text>{zone.containsDriver?<Text style={styles.driverDemandHere}>ACÁ</Text>:null}</View><Text style={styles.driverDemandName}>{zone.name}</Text><Text style={styles.driverDemandJobs}>{zone.openJobs===0?"Sin trabajos abiertos":`${zone.openJobs} ${zone.openJobs===1?"trabajo":"trabajos"} sin asignar`}</Text><Text style={styles.driverDemandSupply}>{zone.eligibleDrivers} {zone.eligibleDrivers===1?"conductor elegible":"conductores elegibles"}</Text></View>})}</ScrollView>
        <View style={styles.driverTransparencyCard}><Ionicons name="information-circle-outline" size={22} color="#087a50"/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>Actividad, no promesa</Text><Text style={styles.cardText}>Es un conteo zonal actual: no garantiza una oferta o ganancia y no modifica la tarifa. Nunca muestra la ubicación de otras personas.</Text></View></View>
      </> : <Pressable style={styles.driverDemandError} onPress={()=>void loadDriverDemand()}><Ionicons name={driverDemandError?"cloud-offline-outline":"map-outline"} size={22} color="#a33939"/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{driverDemandError?"No pudimos leer las zonas":"No hay zonas operativas"}</Text><Text style={styles.cardText}>{driverDemandError||"Operaciones todavía no publicó polígonos activos para esta ciudad."} · Tocá para reintentar.</Text></View></Pressable>}
      {driverRoute?.steps[0] && (
        <View style={styles.driverNavigation}>
          <View style={styles.navigationTurn}>
            <Ionicons
              name={
                driverRoute.steps[0].modifier.includes("left")
                  ? "arrow-back"
                  : driverRoute.steps[0].modifier.includes("right")
                    ? "arrow-forward"
                    : "arrow-up"
              }
              size={26}
              color="#fff"
            />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.navigationLabel}>
              {navigationTarget?.kind.toUpperCase()} · {navigationTarget?.phase.toUpperCase()}
            </Text>
            <Text style={styles.navigationInstruction}>
              {navigationInstruction(driverRoute.steps[0])}
            </Text>
            <Text style={styles.helperText}>
              {driverRoute.distanceKm} km · {driverRoute.durationMin} min
              restantes
            </Text>
            <Text style={styles.helperText} numberOfLines={1}>{navigationTarget?.address}</Text>
          </View>
          <Pressable style={styles.proofCameraButton} onPress={()=>setNavigationOpen(true)} accessibilityRole="button" accessibilityLabel="Abrir guía operativa del conductor">
            <Ionicons name="navigate" size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>Ver guía</Text>
          </Pressable>
        </View>
      )}
      {driverRouteError ? <Text style={styles.complianceRejection}>{driverRouteError}</Text> : null}
      <View style={styles.cardDark}>
        <Text style={styles.heroLabel}>{driver.online ? "Online" : "Offline"}</Text>
        <Text style={styles.heroTitle}>{driver.name}</Text>
        <Text style={styles.heroCopy}>{driver.vehicle} - {driver.plate} - rating {driver.rating}</Text>
        <Text style={styles.gpsText}>{gpsStatus === "live"?"GPS activo":gpsStatus === "requesting"?"Solicitando GPS":gpsStatus === "denied"?"GPS no disponible":"GPS pausado"}</Text>
        <Text style={styles.gpsText}>{backgroundGps==="active"?"Segundo plano activo":backgroundGps==="foreground_only"?"Sólo mientras la app está abierta":backgroundGps==="denied"?"Permiso background rechazado":"Segundo plano detenido"} · sesión {api.sessionStorage==="native-keychain-keystore"?"protegida":"web"}</Text>
      </View>
      <KpiRow items={[["Ganancias",driver.earningsToday],["Activos",activeOrders.length+activeRides.length+activeShipments.length],["Ofertas",visibleOffers.length],["Modo",driver.activeService==="delivery"?"Delivery":"Taxi"]]}/>
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.stack}><OrderCard
          order={order}
          disabled={busy}
          onPress={() =>
            runAction(() => api.advanceOrder(order.id), "Delivery avanzado")
          }
        /><Pressable style={styles.shareAction} onPress={()=>setChatJobId(order.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat del servicio</Text></Pressable></View>
      ))}
      {activeRides.map((ride) => (
        <View key={ride.id} style={styles.stack}>
          <RideCard
            ride={ride}
            disabled={busy||ride.status==="arriving"}
            onPress={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
          />
          <Pressable style={styles.shareAction} onPress={()=>setChatJobId(ride.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat con pasajero</Text></Pressable>
          {ride.status==="arriving"?<View style={styles.deliveryProofCard}><View style={[styles.deliveryProofIcon,{backgroundColor:"#7c3cff"}]}><Ionicons name="keypad-outline" size={22} color="#fff"/></View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>Verificá al pasajero</Text><Text style={styles.cardText}>Pedile el PIN de 4 dígitos antes de iniciar.</Text><TextInput value={ridePickupPins[ride.id]||""} onChangeText={value=>setRidePickupPins(current=>({...current,[ride.id]:value.replace(/\D/g,"").slice(0,4)}))} keyboardType="numeric" secureTextEntry maxLength={4} placeholder="••••" style={styles.input}/></View><Pressable disabled={busy||(ridePickupPins[ride.id]||"").length!==4} style={[styles.proofCameraButton,(busy||(ridePickupPins[ride.id]||"").length!==4)&&styles.disabledButton]} onPress={()=>runAction(async()=>{await api.verifyRidePickup(ride.id,ridePickupPins[ride.id]);await api.advanceRide(ride.id);setRidePickupPins(current=>({...current,[ride.id]:""}));},"Pasajero verificado; viaje iniciado")}><Ionicons name="shield-checkmark-outline" size={18} color="#fff"/><Text style={styles.primaryButtonText}>Verificar e iniciar</Text></Pressable></View>:null}
        </View>
      ))}
      {activeShipments.map((shipment) => (
        <View key={shipment.id} style={styles.stack}>
        <ShipmentCard
          shipment={shipment}
          disabled={busy}
          pin={deliveryPins[shipment.id] || ""}
          onPinChange={(pin) =>
            setDeliveryPins((current) => ({
              ...current,
              [shipment.id]: pin.replace(/\D/g, "").slice(0, 4),
            }))
          }
          onPress={() =>
            runAction(
              () =>
                shipment.status === "delivering"
                  ? api.verifyShipmentDelivery(
                      shipment.id,
                      deliveryPins[shipment.id] || "",
                    )
                  : api.advanceShipment(shipment.id),
              shipment.status === "delivering"
                ? "Entrega verificada"
                : "Envio avanzado",
            )
          }
        />
        <Pressable style={styles.shareAction} onPress={()=>setChatJobId(shipment.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat con cliente</Text></Pressable>
        {shipment.status==="delivering"&&<><View style={styles.deliveryProofCard}><View style={styles.deliveryProofIcon}><Ionicons name={deliveryEvidenceReady[shipment.id]?"shield-checkmark":"camera"} size={22} color="#fff"/></View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{deliveryEvidenceReady[shipment.id]?"Foto protegida":"Prueba de entrega"}</Text><Text style={styles.cardText}>{deliveryEvidenceReady[shipment.id]?"Foto cifrada lista.":"Tomá una foto en destino antes de pedir el PIN."}</Text></View><Pressable disabled={deliveryEvidenceUploading===shipment.id||busy} style={[styles.proofCameraButton,(deliveryEvidenceUploading===shipment.id||busy)&&styles.disabledButton]} onPress={()=>void captureDeliveryEvidence(shipment.id)}><Ionicons name="camera-outline" size={18} color="#fff"/><Text style={styles.primaryButtonText}>{deliveryEvidenceUploading===shipment.id?"Guardando…":deliveryEvidenceReady[shipment.id]?"Repetir":"Tomar foto"}</Text></Pressable></View>{shipment.signatureRequired&&<View style={styles.deliveryProofCard}><View style={[styles.deliveryProofIcon,{backgroundColor:"#17131c"}]}><Ionicons name={deliverySignatureReady[shipment.id]?"checkmark":"pencil"} size={22} color="#fff"/></View><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{deliverySignatureReady[shipment.id]?"Firma protegida":"Firma requerida"}</Text><Text style={styles.cardText}>{deliverySignatureReady[shipment.id]?"Identidad y consentimiento cifrados.":"Pedile al receptor que firme en pantalla."}</Text></View><Pressable disabled={deliveryEvidenceUploading===shipment.id||busy} style={[styles.proofCameraButton,(deliveryEvidenceUploading===shipment.id||busy)&&styles.disabledButton]} onPress={()=>setSignatureShipmentId(shipment.id)}><Ionicons name="create-outline" size={18} color="#fff"/><Text style={styles.primaryButtonText}>{deliverySignatureReady[shipment.id]?"Repetir":"Firmar"}</Text></Pressable></View>}</>}
        </View>
      ))}
      {activeOrders.length === 0 &&
        activeRides.length === 0 &&
        activeShipments.length === 0 && (
          <Text style={styles.muted}>No tienes trabajos activos.</Text>
        )}
      <Text style={styles.sectionTitle}>Ofertas</Text>
      {offersLoading && visibleOffers.length === 0 && (
        <ActivityIndicator color="#7c3cff" />
      )}
      {visibleOffers.map((offer) => {
        const seconds = Math.max(
          0,
          Math.ceil((new Date(offer.expiresAt).getTime() - clock) / 1000),
        );
        const accepting = offerBusy === offer.id;
        return (
          <View key={offer.id} style={styles.dispatchOffer}>
            <View style={styles.dispatchOfferHeader}>
              <View style={styles.dispatchOfferIcon}>
                <Ionicons
                  name={offer.kind === "ride" ? "car-sport" : "cube"}
                  size={22}
                  color="#fff"
                />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.dispatchOfferType}>
                  {offer.kind === "ride"
                    ? "NUEVO VIAJE"
                    : offer.subtype === "shipment"
                      ? "NUEVO ENVÍO"
                      : "NUEVO DELIVERY"}
                </Text>
                <Text style={styles.dispatchOfferTimer}>{seconds}s</Text>
              </View>
              <Text style={styles.dispatchOfferFare}>
                {money.format(offer.fare)}
              </Text>
            </View>
            <View style={styles.dispatchRoute}>
              <View style={styles.routeDot} />
              <Text style={styles.dispatchAddress} numberOfLines={1}>
                {offer.pickup}
              </Text>
            </View>
            <View style={styles.dispatchRoute}>
              <View style={[styles.routeDot, styles.routeDotDestination]} />
              <Text style={styles.dispatchAddress} numberOfLines={1}>
                {offer.destination}
              </Text>
            </View>
            <Text style={styles.helperText}>
              {offer.distanceKm} km · {offer.durationMin} min · puntaje{" "}
              {Math.round(offer.score)}
            </Text>
            {offer.scoreBreakdown&&<Text style={styles.helperText}>Historial: {Math.round(offer.scoreBreakdown.acceptanceRate*100)}% aceptación · {Math.round(offer.scoreBreakdown.averageResponseSeconds)}s respuesta</Text>}
            <View style={styles.offerActions}>
              <Pressable
                disabled={busy || accepting || seconds === 0}
                style={styles.rejectOfferButton}
                onPress={async () => {
                  setOfferBusy(offer.id);
                  await runAction(
                    () => api.rejectDriverOffer(offer.id),
                    "Oferta rechazada",
                  );
                  await loadOffers();
                  setOfferBusy(null);
                }}
              >
                <Text style={styles.rejectOfferText}>Rechazar</Text>
              </Pressable>
              <Pressable
                disabled={busy || accepting || seconds === 0}
                style={styles.acceptOfferButton}
                onPress={async () => {
                  setOfferBusy(offer.id);
                  const action =
                    offer.kind === "ride"
                      ? () => api.acceptRide(offer.jobId, driver.id)
                      : offer.subtype === "shipment"
                        ? () => api.acceptShipment(offer.jobId, driver.id)
                        : () => api.acceptDelivery(offer.jobId, driver.id);
                  await runAction(action, "Servicio aceptado");
                  await loadOffers();
                  setOfferBusy(null);
                }}
              >
                {accepting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.acceptOfferText}>Aceptar</Text>
                )}
              </Pressable>
            </View>
          </View>
        );
      })}
      {!offersLoading && visibleOffers.length === 0 && (
        <Text style={styles.muted}>
          {driver.online
            ? "No hay ofertas vigentes para el modo seleccionado."
            : "Actívate para recibir ofertas."}
        </Text>
      )}
      </>}
      </ScrollView>
      <View style={styles.driverBottomNav}>{([['home','map-outline','Mapa'],['earnings','wallet-outline','Ganancias'],['inbox','chatbox-ellipses-outline','Inbox'],['account','person-circle-outline','Cuenta']] as const).map(([value,icon,label])=><Pressable key={value} style={styles.driverBottomItem} onPress={()=>setDriverView(value)} accessibilityRole="tab" accessibilityState={{selected:driverView===value}}><View style={styles.driverBottomIconWrap}><Ionicons name={icon} size={22} color={driverView===value?"#7c3cff":"#8a828f"}/>{value==="inbox"&&driverNotifications.some(item=>!item.readAt)?<View style={styles.driverBottomDot}/>:null}</View><Text style={[styles.driverBottomLabel,driverView===value&&styles.driverBottomLabelActive]}>{label}</Text></Pressable>)}</View>
    </View>
  );
}

function KpiRow({ items }: { items: Array<[string, number | string]> }) {
  return (
    <View style={styles.kpiGrid}>
      {items.map(([label, value]) => (
        <View key={label} style={styles.kpi}>
          <Text style={styles.kpiLabel}>{label}</Text>
          <Text style={styles.kpiValue}>
            {typeof value === "number" && value > 999
              ? money.format(value)
              : value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function OrderCard({
  order,
  disabled,
  onPress,
}: {
  order: Order;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{mobileOrderStatusLabel[order.status]}</Text>
      <Text style={styles.cardText}>{order.deliveryAddress}</Text>
      <Text style={styles.cardText}>
        {order.items.length} items - {money.format(order.total)}
      </Text>
      {onPress && (
        <ActionButton label="Avanzar" disabled={disabled} onPress={onPress} />
      )}
    </View>
  );
}

function RideCard({
  ride,
  disabled,
  onPress,
}: {
  ride: Ride;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{ride.status}</Text>
      <Text style={styles.cardText}>
        {ride.pickup} {"->"} {ride.destination}
      </Text>
      <Text style={styles.cardText}>
        {ride.distanceKm} km - {money.format(ride.fare)}
      </Text>
      {onPress && (
        <ActionButton label="Gestionar" disabled={disabled} onPress={onPress} />
      )}
    </View>
  );
}

function ShipmentCard({
  shipment,
  disabled,
  onPress,
  pin = "",
  onPinChange,
}: {
  shipment: AppState["shipments"][number];
  disabled?: boolean;
  onPress?: () => void;
  pin?: string;
  onPinChange?: (value: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Envio · {shipment.status}</Text>
      <Text style={styles.cardText}>
        {shipment.pickup} → {shipment.destination}
      </Text>
      <Text style={styles.cardText}>
        {shipment.weightKg} kg · {money.format(shipment.fare)}
      </Text>
      <Text style={styles.helperText}>{shipment.serviceLevel?.toUpperCase()} · {shipment.itemCategory}{shipment.handlingInstructions?` · ${shipment.handlingInstructions}`:""}</Text>
      {(shipment.deliveryEvidenceCount||0)>0&&<View style={styles.deliveryEvidenceBadge}><Ionicons name="shield-checkmark" size={16} color="#087a50"/><Text style={styles.deliveryEvidenceBadgeText}>{shipment.status==="delivered"?(shipment.signatureRequired?"Entrega verificada con foto + firma + PIN":"Entrega verificada con foto + PIN"):(shipment.signatureRequired?"Evidencia de entrega protegida":"Foto de entrega protegida")}</Text></View>}
      {shipment.status === "delivering" && onPinChange ? (
        <>
          <Text style={styles.cardText}>Solicitá el PIN al destinatario</Text>
          <TextInput
            value={pin}
            onChangeText={onPinChange}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            placeholder="PIN de 4 dígitos"
            style={styles.input}
          />
        </>
      ) : null}
      {onPress && (
        <ActionButton
          label={
            shipment.status === "delivering"
              ? "Confirmar entrega"
              : "Gestionar envio"
          }
          disabled={
            disabled || (shipment.status === "delivering" && pin.length !== 4)
          }
          onPress={onPress}
        />
      )}
    </View>
  );
}

function ActionButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, disabled && styles.actionDisabled]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f4f6f8",
  },
  appViewport: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    overflow: "hidden",
  },
  customerViewport: { maxWidth: 430, backgroundColor: "#fff" },
  operationsViewport: { maxWidth: 620, backgroundColor: "#f6f3f0" },
  loginSafeArea: { flex: 1, width: "100%", backgroundColor: "#f4f6f8" },
  networkStatusBanner: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    zIndex: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#7e2f24",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  networkStatusIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.16)",
  },
  networkStatusCopy: { flex: 1, minWidth: 0 },
  networkStatusTitle: { color: "#fff", fontSize: 12, fontWeight: "900" },
  networkStatusText: { color: "rgba(255,255,255,.82)", fontSize: 10, marginTop: 2 },
  customerRoot: { backgroundColor: "#eef0f3" },
  customerShell: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: "#fff",
  },
  customerScrollContent: { padding: flashDesign.space.md, paddingBottom: flashDesign.space.xl, backgroundColor: flashDesign.color.canvas },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: "#161b22",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: "#ffcc1c",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  badge: {
    color: "#fff",
    backgroundColor: "#16a66a",
    borderRadius: 8,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "900",
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    backgroundColor: "#fff",
  },
  tab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#f0f2f5",
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: "#f4511e",
  },
  tabText: {
    color: "#626a78",
    fontWeight: "900",
  },
  tabTextActive: {
    color: "#fff",
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  muted: {
    color: "#626a78",
  },
  content: {
    padding: 14,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  customerContent: {
    maxWidth: 420,
    backgroundColor: "#fff",
    minHeight: "100%",
  },
  stack: {
    gap: 12,
  },
  logoutButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { color: "#fff", fontWeight: "900" },
  sessionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e8e5eb",
  },
  sessionRole: {
    color: "#f4511e",
    fontWeight: "900",
    textTransform: "uppercase",
    fontSize: 12,
  },
  sessionName: { color: "#17131c", fontWeight: "900" },
  loginRoot: {
    flex: 1,
    justifyContent: "center",
    padding: 22,
    backgroundColor: "#6f00ff",
    gap: 24,
    overflow: "hidden",
  },
  loginGlow: {
    position: "absolute",
    top: -90,
    right: -70,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "rgba(255,255,255,.14)",
  },
  loginBrand: { alignItems: "center", gap: 8 },
  loginMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#210048",
    shadowOpacity: 0.28,
    shadowRadius: 18,
  },
  loginTitle: { color: "#fff", fontSize: 34, fontWeight: "900" },
  loginCopy: { color: "rgba(255,255,255,.68)", textAlign: "center" },
  loginCard: {
    padding: 20,
    borderRadius: 24,
    backgroundColor: "#fff",
    gap: 12,
  },
  loginError: { color: "#c92d2d", fontWeight: "800" },
  loginSwitch: { alignItems: "center", paddingVertical: 8 },
  loginSwitchText: { color: "#7200d8", fontWeight: "800" },
  serviceNav: {
    flexDirection: "row",
    gap: flashDesign.space.xs,
    padding: 5,
    borderRadius: flashDesign.radius.surface,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    shadowColor: flashDesign.color.ink,
    shadowOffset: {width:0,height:8},
    shadowOpacity: .06,
    shadowRadius: 16,
    elevation: 2,
  },
  serviceNavItem: {
    flex: 1,
    minHeight: 62,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  serviceNavItemActive: { backgroundColor: flashDesign.color.ink },
  serviceIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: flashDesign.color.warningSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceIconBubbleActive: { backgroundColor: flashDesign.color.food },
  serviceNavText: { color: "#625b69", fontSize: 12, fontWeight: "900" },
  serviceNavTextActive: { color: "#fff" },
  foodHero: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: "#ff6a21",
    gap: 10,
  },
  foodHeroTitle: { color: "#fff", fontSize: 28, fontWeight: "900" },
  foodTopbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: flashDesign.space.sm,
    paddingTop: 2,
  },
  foodLocationBlock:{flex:1,minWidth:0,flexDirection:"row",alignItems:"center",gap:10},
  foodLocationIcon:{width:flashDesign.control.touch,height:flashDesign.control.touch,borderRadius:16,alignItems:"center",justifyContent:"center",backgroundColor:flashDesign.color.warningSoft},
  foodLocationCopy:{flex:1,minWidth:0,gap:2},
  foodTopActions:{flexDirection:"row",alignItems:"center",gap:8},
  foodAvatar:{width:flashDesign.control.touch,height:flashDesign.control.touch,borderRadius:17,alignItems:"center",justifyContent:"center",backgroundColor:"#EEE7FF",borderWidth:1,borderColor:"#DED0FF"},
  foodAvatarText:{color:flashDesign.color.brandDeep,fontSize:16,fontWeight:"900"},
  foodDeliverLabel: {
    color: flashDesign.color.foodDeep,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  foodAddress: {
    color: flashDesign.color.ink,
    fontSize:13,
    fontWeight: "900",
  },
  foodCartIcon: {
    width: flashDesign.control.touch,
    height: flashDesign.control.touch,
    borderRadius: 17,
    backgroundColor: flashDesign.color.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  foodCartCount: {
    position: "absolute",
    right: -4,
    top: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: flashDesign.color.food,
    color: "#fff",
    fontSize: 10,
    textAlign: "center",
    paddingTop: 2,
    overflow: "hidden",
  },
  foodHomeHeading:{gap:3,paddingTop:6,paddingBottom:2},
  foodHomeEyebrow:{color:flashDesign.color.foodDeep,fontSize:10,fontWeight:"900",letterSpacing:1.2},
  foodHomeTitle:{color:flashDesign.color.ink,fontSize:flashDesign.type.display,lineHeight:35,fontWeight:"900",letterSpacing:-1},
  foodPromoBanner:{minHeight:186,borderRadius:flashDesign.radius.surface,padding:18,overflow:"hidden",flexDirection:"row",alignItems:"stretch",shadowColor:flashDesign.color.ink,shadowOffset:{width:0,height:12},shadowOpacity:.14,shadowRadius:22,elevation:4},
  foodPromoCopy:{flex:1,minWidth:0,alignItems:"flex-start",justifyContent:"center",gap:7,zIndex:2},
  foodPromoBadge:{flexDirection:"row",alignItems:"center",gap:5,paddingHorizontal:9,paddingVertical:5,borderRadius:flashDesign.radius.pill,backgroundColor:"rgba(255,255,255,.12)"},
  foodPromoBadgeText:{color:"#FFD6C2",fontSize:10,fontWeight:"900",letterSpacing:.4,textTransform:"uppercase"},
  foodPromoTitle:{color:"#fff",fontSize:22,lineHeight:26,fontWeight:"900",letterSpacing:-.5},
  foodPromoDescription:{color:"rgba(255,255,255,.72)",fontSize:12,lineHeight:17},
  foodPromoAction:{minHeight:38,flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:13,borderRadius:12,backgroundColor:"#fff",marginTop:2},
  foodPromoActionText:{color:flashDesign.color.ink,fontSize:11,fontWeight:"900"},
  foodPromoArt:{width:90,alignItems:"center",justifyContent:"center",marginRight:-4,transform:[{rotate:"-7deg"}],borderRadius:32,backgroundColor:flashDesign.color.food},
  foodPromoArtDot:{position:"absolute",right:-18,bottom:-20,width:58,height:58,borderRadius:29,backgroundColor:"rgba(255,255,255,.18)"},
  foodSearchButton: {
    minHeight: 54,
    borderRadius: 18,
    paddingLeft: 15,
    paddingRight: 7,
    backgroundColor: flashDesign.color.surface,
    borderWidth:1,
    borderColor:flashDesign.color.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  foodSearchPlaceholder: { color: flashDesign.color.muted, flex: 1,fontSize:13 },
  foodSearchFilter:{width:40,height:40,borderRadius:14,alignItems:"center",justifyContent:"center",backgroundColor:flashDesign.color.ink},
  foodSearchInput: { color: "#252128", flex: 1, minHeight: 46 },
  foodSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap:12,
  },
  foodSectionTitle: { color: flashDesign.color.ink, fontSize: flashDesign.type.section, fontWeight: "900",letterSpacing:-.3 },
  foodSeeAll: { color: flashDesign.color.inkSoft, fontSize: 11, fontWeight: "800" },
  foodCategoryRail: { gap: 10, paddingVertical: 4,paddingRight:4 },
  foodCategoryItem: { width: 76, alignItems: "center", gap: 7 },
  foodCategoryArt: {
    width: 68,
    height: 68,
    borderRadius: 23,
    backgroundColor: flashDesign.color.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  foodCategoryArtActive: {
    borderColor: flashDesign.color.food,
    borderWidth: 2,
    shadowColor: flashDesign.color.food,
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation:2,
  },
  foodCategoryImage: { width: 60, height: 60, borderRadius: 19 },
  foodCategoryName: { minHeight:28,color: flashDesign.color.inkSoft, fontSize: 10, lineHeight:13,fontWeight: "800",textAlign:"center" },
  foodCategoryNameActive:{color:flashDesign.color.foodDeep,fontWeight:"900"},
  foodFavoriteRail:{gap:12,paddingRight:4,paddingBottom:2},
  foodFavoriteCard:{width:166,padding:7,borderRadius:19,backgroundColor:flashDesign.color.surface,borderWidth:1,borderColor:flashDesign.color.line},
  foodFavoriteImage:{height:94,padding:7,alignItems:"flex-end"},
  foodFavoriteImageStyle:{borderRadius:14},
  foodFavoriteEta:{flexDirection:"row",alignItems:"center",gap:4,paddingHorizontal:7,paddingVertical:5,borderRadius:flashDesign.radius.pill,backgroundColor:"rgba(255,255,255,.94)"},
  foodFavoriteEtaText:{color:flashDesign.color.ink,fontSize:9,fontWeight:"900"},
  foodFavoriteName:{color:flashDesign.color.ink,fontSize:13,fontWeight:"900",marginTop:7,paddingHorizontal:2},
  foodFavoriteMeta:{color:flashDesign.color.muted,fontSize:10,marginTop:2,paddingHorizontal:2,paddingBottom:2},
  foodOffer: {
    minHeight: 112,
    borderRadius: 22,
    padding: 17,
    backgroundColor: "#ffad25",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  foodOfferKicker: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  foodOfferTitle: {
    color: "#fff",
    fontSize: 23,
    fontWeight: "900",
    marginTop: 3,
  },
  foodOfferCopy: { color: "rgba(255,255,255,.85)", marginTop: 4 },
  foodPopularRail: { gap: 12, paddingBottom: 3 },
  foodPopularCard: {
    width: 150,
    padding: 8,
    borderRadius: 18,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eee9ec",
  },
  foodPopularImage: {
    height: 104,
    borderRadius: 14,
    padding: 8,
    alignItems: "flex-end",
  },
  foodPopularImageStyle: { borderRadius: 14 },
  foodPopularEta: {
    color: "#252128",
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
  },
  foodPopularName: { color: "#252128", fontWeight: "900", marginTop: 8 },
  foodPopularRestaurant: { color: "#88838a", fontSize: 11, marginTop: 2 },
  foodMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap:"wrap",
    gap: 7,
  },
  foodRating: { color: "#ff6a21", fontWeight: "900" },
  foodMetaItem:{flexDirection:"row",alignItems:"center",gap:4},
  foodMetaText:{color:flashDesign.color.inkSoft,fontSize:11,fontWeight:"700"},
  foodMetaDot:{width:3,height:3,borderRadius:2,backgroundColor:"#C3BDC7"},
  foodHeart: {
    width: flashDesign.control.touch,
    height: flashDesign.control.touch,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,.96)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor:flashDesign.color.ink,
    shadowOpacity:.12,
    shadowRadius:10,
    elevation:2,
  },
  foodPageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 50,
  },
  foodPageHeaderCopy:{flex:1,minWidth:0,gap:2},
  foodBack: {
    width: flashDesign.control.touch,
    height: flashDesign.control.touch,
    borderRadius: 16,
    backgroundColor: flashDesign.color.surface,
    borderWidth:1,
    borderColor:flashDesign.color.line,
    alignItems: "center",
    justifyContent: "center",
  },
  foodPageTitle: { color: flashDesign.color.ink, fontSize: 19, fontWeight: "900",letterSpacing:-.3 },
  foodPageSubtitle:{color:flashDesign.color.inkSoft,fontSize:10,fontWeight:"700"},
  foodSearchClear:{width:38,height:38,borderRadius:14,alignItems:"center",justifyContent:"center",backgroundColor:flashDesign.color.surfaceMuted},
  foodSearchCategoryRail:{gap:10,paddingRight:4,paddingBottom:2},
  foodSearchCategoryCard:{width:126,padding:8,borderRadius:18,backgroundColor:flashDesign.color.surface,borderWidth:1,borderColor:flashDesign.color.line},
  foodSearchCategoryImage:{width:"100%",height:74,borderRadius:13},
  foodSearchCategoryImageFallback:{width:"100%",height:74,borderRadius:13,alignItems:"center",justifyContent:"center",backgroundColor:flashDesign.color.warningSoft},
  foodSearchCategoryName:{minHeight:30,color:flashDesign.color.ink,fontSize:12,lineHeight:15,fontWeight:"900",marginTop:7},
  foodSearchCategoryCount:{color:flashDesign.color.muted,fontSize:9,fontWeight:"700",marginTop:2},
  foodSearchSkeletonList:{gap:10},
  foodSearchSkeletonCard:{minHeight:110,flexDirection:"row",gap:12,padding:9,borderRadius:20,backgroundColor:flashDesign.color.surface,borderWidth:1,borderColor:flashDesign.color.line},
  foodSearchSkeletonImage:{width:98,borderRadius:14,backgroundColor:"#E9E5EC"},
  foodSearchSkeletonCopy:{flex:1,justifyContent:"center",gap:9},
  foodSearchSkeletonTitle:{width:"72%",height:14,borderRadius:7,backgroundColor:"#E6E1E9"},
  foodSearchSkeletonLine:{width:"92%",height:10,borderRadius:5,backgroundColor:"#EEEAF0"},
  foodSearchSkeletonShort:{width:"52%",height:10,borderRadius:5,backgroundColor:"#EEEAF0"},
  foodSearchState:{minHeight:220,alignItems:"center",justifyContent:"center",gap:9,padding:22,borderRadius:flashDesign.radius.surface,backgroundColor:flashDesign.color.surface,borderWidth:1,borderColor:flashDesign.color.line},
  foodSearchStateIcon:{width:54,height:54,borderRadius:19,alignItems:"center",justifyContent:"center",backgroundColor:flashDesign.color.warningSoft},
  foodSearchStateTitle:{color:flashDesign.color.ink,fontSize:17,fontWeight:"900"},
  foodSearchStateCopy:{maxWidth:270,color:flashDesign.color.inkSoft,fontSize:12,lineHeight:18,textAlign:"center"},
  foodSearchRetry:{minHeight:42,alignItems:"center",justifyContent:"center",paddingHorizontal:16,borderRadius:13,backgroundColor:flashDesign.color.ink,marginTop:2},
  foodSearchRetryText:{color:"#fff",fontSize:11,fontWeight:"900"},
  foodSearchResultCard:{overflow:"hidden",borderRadius:21,backgroundColor:flashDesign.color.surface,borderWidth:1,borderColor:flashDesign.color.line,shadowColor:flashDesign.color.ink,shadowOffset:{width:0,height:8},shadowOpacity:.06,shadowRadius:15,elevation:2},
  foodSearchResultImage:{height:148,padding:10,alignItems:"flex-end"},
  foodSearchResultEta:{flexDirection:"row",alignItems:"center",gap:4,paddingHorizontal:8,paddingVertical:6,borderRadius:flashDesign.radius.pill,backgroundColor:"rgba(255,255,255,.95)"},
  foodSearchResultEtaText:{color:flashDesign.color.ink,fontSize:10,fontWeight:"900"},
  foodSearchResultBody:{gap:6,padding:13},
  foodSearchResultHeading:{flexDirection:"row",alignItems:"center",gap:8},
  foodSearchResultName:{flex:1,color:flashDesign.color.ink,fontSize:16,fontWeight:"900"},
  foodSearchResultCuisine:{color:flashDesign.color.inkSoft,fontSize:11},
  foodSearchResultMeta:{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:6},
  foodSearchResultMetaText:{color:flashDesign.color.inkSoft,fontSize:10,fontWeight:"700"},
  foodSearchResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 10,
  },
  foodResultImage: { width: 70, height: 62, borderRadius: 13 },
  foodRestaurantHero: {
    width:"100%",
    aspectRatio:16/9,
    borderRadius: flashDesign.radius.surface,
    overflow:"hidden",
    padding: 13,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  foodRestaurantHeroImage: { borderRadius: flashDesign.radius.surface },
  foodFloatingButton: {
    width: flashDesign.control.touch,
    height: flashDesign.control.touch,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,.96)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor:flashDesign.color.ink,
    shadowOpacity:.14,
    shadowRadius:10,
    elevation:2,
  },
  foodRestaurantInfo: {
    backgroundColor: flashDesign.color.surface,
    borderRadius: flashDesign.radius.surface,
    borderWidth:1,
    borderColor:flashDesign.color.line,
    padding: 17,
    marginTop: -26,
    marginHorizontal: 10,
    gap: 9,
    shadowColor:flashDesign.color.ink,
    shadowOffset:{width:0,height:10},
    shadowOpacity:.1,
    shadowRadius:18,
    elevation:4,
  },
  foodRestaurantStatusRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"},
  foodRestaurantOpenBadge:{flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:9,paddingVertical:5,borderRadius:flashDesign.radius.pill,backgroundColor:flashDesign.color.successSoft},
  foodRestaurantOpenDot:{width:7,height:7,borderRadius:4,backgroundColor:flashDesign.color.shipment},
  foodRestaurantOpenText:{color:flashDesign.color.shipment,fontSize:9,fontWeight:"900",textTransform:"uppercase",letterSpacing:.5},
  foodRestaurantOfferBadge:{maxWidth:"58%",color:flashDesign.color.foodDeep,fontSize:9,fontWeight:"900",paddingHorizontal:9,paddingVertical:5,borderRadius:flashDesign.radius.pill,overflow:"hidden",backgroundColor:flashDesign.color.warningSoft},
  foodRestaurantTitle: { color: flashDesign.color.ink, fontSize: 23, lineHeight:28,fontWeight: "900",letterSpacing:-.5 },
  foodRestaurantCuisine:{color:flashDesign.color.inkSoft,fontSize:11,lineHeight:16},
  foodRestaurantFacts:{flexDirection:"row",gap:8,paddingTop:3},
  foodRestaurantFact:{flex:1,minWidth:0,flexDirection:"row",alignItems:"center",gap:7,padding:8,borderRadius:14,backgroundColor:flashDesign.color.canvas},
  foodRestaurantFactIcon:{width:30,height:30,borderRadius:11,alignItems:"center",justifyContent:"center",backgroundColor:flashDesign.color.surface},
  foodRestaurantFactValue:{color:flashDesign.color.ink,fontSize:11,fontWeight:"900"},
  foodRestaurantFactLabel:{color:flashDesign.color.muted,fontSize:8,marginTop:1},
  foodMenuTabs: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
    paddingRight:4,
  },
  foodMenuTabButton:{minHeight:40,alignItems:"center",justifyContent:"center",paddingHorizontal:14,borderRadius:14,backgroundColor:flashDesign.color.surface,borderWidth:1,borderColor:flashDesign.color.line},
  foodMenuTabButtonActive:{backgroundColor:flashDesign.color.ink,borderColor:flashDesign.color.ink},
  foodMenuTab: { color: flashDesign.color.inkSoft,fontSize:11, fontWeight: "800" },
  foodMenuTabActive: {
    color: "#fff",
    fontWeight: "900",
  },
  foodProductCard: {
    minHeight: 122,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: flashDesign.color.surface,
    borderRadius: 20,
    borderWidth:1,
    borderColor:flashDesign.color.line,
    padding: 9,
  },
  foodProductImage: { width: 104, height: 104, borderRadius: 16,alignItems:"center",justifyContent:"center",overflow:"hidden" },
  foodProductImageStyle: { borderRadius: 16 },
  foodProductUnavailable:{paddingHorizontal:8,paddingVertical:5,borderRadius:10,backgroundColor:"rgba(23,19,28,.78)"},
  foodProductUnavailableText:{color:"#fff",fontSize:8,fontWeight:"900",letterSpacing:.8},
  foodProductHeading:{flexDirection:"row",alignItems:"flex-start",gap:6},
  foodProductName:{flex:1,color:flashDesign.color.ink,fontSize:14,lineHeight:18,fontWeight:"900"},
  foodProductDescription:{color:flashDesign.color.inkSoft,fontSize:10,lineHeight:14},
  foodProductPrice: { color: flashDesign.color.foodDeep, fontWeight: "900", marginTop: 3 },
  foodAddButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: flashDesign.color.food,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
  },
  foodAddButtonDisabled:{backgroundColor:"#C8C2CB"},
  foodStickyCart: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: "#ff6a21",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 12,
  },
  foodStickyCount: {
    width: 30,
    height: 30,
    borderRadius: 10,
    paddingTop: 5,
    textAlign: "center",
    color: "#ff6a21",
    backgroundColor: "#fff",
    fontWeight: "900",
    overflow: "hidden",
  },
  foodStickyLabel: { color: "#fff", fontWeight: "900", flex: 1 },
  foodStickyPrice: { color: "#fff", fontWeight: "900" },
  foodCartLine: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 15,
  },
  foodQuantity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "#fff3ea",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  foodTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  foodEmpty: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: flashDesign.color.surface,
    borderRadius: flashDesign.radius.surface,
    borderWidth:1,
    borderColor:flashDesign.color.line,
    padding: 24,
  },
  foodEmptyIcon:{width:58,height:58,borderRadius:20,alignItems:"center",justifyContent:"center",backgroundColor:flashDesign.color.warningSoft},
  foodEmptyTitle:{color:flashDesign.color.ink,fontSize:18,fontWeight:"900",textAlign:"center"},
  foodEmptyCopy:{maxWidth:280,color:flashDesign.color.inkSoft,fontSize:12,lineHeight:18,textAlign:"center"},
  foodEmptyAction:{minHeight:44,alignItems:"center",justifyContent:"center",paddingHorizontal:18,borderRadius:14,backgroundColor:flashDesign.color.ink},
  foodEmptyActionText:{color:"#fff",fontSize:12,fontWeight:"900"},
  foodBottomNav: {
    flexDirection: "row",
    minHeight: 68,
    backgroundColor: "#fff",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#eee9ec",
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 6,
    shadowColor: "#241a28",
    shadowOpacity: 0.1,
    shadowRadius: 14,
  },
  foodBottomItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  foodBottomLabel: { color: "#9c989f", fontSize: 10, fontWeight: "700" },
  foodBottomLabelActive: { color: "#ff6a21" },
  shareAction: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    backgroundColor: "#fff7f2",
    borderWidth: 1,
    borderColor: "#ffe0cf",
  },
  shareActionText: { color: "#ff6a21", fontSize: 12, fontWeight: "900" },
  activityHeading: { paddingVertical: 10, gap: 4 },
  customerAccountHeading: {
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  customerLogoutButton: {
    minHeight: 44,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#dedbe1",
    backgroundColor: "#fff",
  },
  customerLogoutText: { color: "#27242a", fontSize: 13, fontWeight: "900" },
  activityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ebe7ed",
  },
  activityIconFood: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#ff6a21",
    alignItems: "center",
    justifyContent: "center",
  },
  activityIconRide: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#7c3cff",
    alignItems: "center",
    justifyContent: "center",
  },
  substitutionSectionTitle:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12,marginTop:8},
  substitutionCount:{minWidth:30,height:30,paddingHorizontal:8,borderRadius:12,backgroundColor:"#ff6a21",alignItems:"center",justifyContent:"center"},
  substitutionCountText:{color:"#fff",fontSize:13,fontWeight:"900"},
  substitutionCard:{flexDirection:"row",alignItems:"flex-start",gap:12,padding:15,borderRadius:24,backgroundColor:"#fff",borderWidth:1,borderColor:"#ffd8c4",shadowColor:"#7c3cff",shadowOffset:{width:0,height:10},shadowOpacity:.08,shadowRadius:18,elevation:3},
  substitutionAlert:{width:44,height:44,borderRadius:15,backgroundColor:"#7c3cff",alignItems:"center",justifyContent:"center"},
  substitutionContent:{flex:1,gap:10},
  substitutionEyebrow:{color:"#ff6a21",fontSize:10,fontWeight:"900",letterSpacing:1,textTransform:"uppercase"},
  substitutionTitle:{color:"#211d24",fontSize:18,fontWeight:"900"},
  substitutionArrowRow:{flexDirection:"row",alignItems:"center",gap:9,padding:11,borderRadius:16,backgroundColor:"#f8f5fb"},
  substitutionProduct:{flex:1,gap:2},
  substitutionPrice:{color:"#211d24",fontSize:13,fontWeight:"900"},
  substitutionReason:{color:"#736d77",fontSize:12,lineHeight:17},
  substitutionRefund:{flexDirection:"row",alignItems:"center",gap:7,padding:10,borderRadius:13,backgroundColor:"#e6f8ef"},
  substitutionRefundText:{flex:1,color:"#087a50",fontSize:12,fontWeight:"800"},
  substitutionActions:{flexDirection:"row",flexWrap:"wrap",gap:9},
  substitutionReject:{flex:1,minHeight:43,alignItems:"center",justifyContent:"center",borderRadius:14,borderWidth:1,borderColor:"#ddd6e2",backgroundColor:"#fff"},
  substitutionRejectText:{color:"#554f59",fontSize:12,fontWeight:"900"},
  substitutionAccept:{flex:1.35,minHeight:43,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6,borderRadius:14,backgroundColor:"#ff6a21"},
  substitutionAcceptText:{color:"#fff",fontSize:12,fontWeight:"900"},
  reportIssueButton:{minHeight:46,flexDirection:"row",alignItems:"center",gap:8,paddingHorizontal:12,borderRadius:14,backgroundColor:"#fff4f1",borderWidth:1,borderColor:"#ffd9d1"},
  reportIssueText:{flex:1,color:"#a63e2c",fontSize:12,fontWeight:"900"},
  issueModalBackdrop:{flex:1,alignItems:"center",justifyContent:"flex-end",backgroundColor:"rgba(24,18,27,.52)"},
  issueModalSheet:{width:"100%",maxWidth:620,maxHeight:"90%",gap:14,paddingHorizontal:20,paddingTop:10,paddingBottom:28,backgroundColor:"#fff",borderTopLeftRadius:30,borderTopRightRadius:30},
  issueModalHandle:{alignSelf:"center",width:42,height:5,borderRadius:4,backgroundColor:"#ddd6e0"},
  issueModalHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},
  issueModalClose:{width:38,height:38,alignItems:"center",justifyContent:"center",borderRadius:13,backgroundColor:"#f5f1f6"},
  issueCategoryRail:{gap:8,paddingVertical:2},
  issueCategoryPill:{minHeight:38,justifyContent:"center",paddingHorizontal:13,borderRadius:13,borderWidth:1,borderColor:"#e4dde7",backgroundColor:"#fff"},
  issueCategoryPillActive:{borderColor:"#ff6a21",backgroundColor:"#fff3ec"},
  issueCategoryText:{color:"#706872",fontSize:11,fontWeight:"800"},
  issueCategoryTextActive:{color:"#d84d11"},
  issueFieldLabel:{color:"#302a32",fontSize:12,fontWeight:"900"},
  issueDescriptionInput:{minHeight:96,textAlignVertical:"top",paddingTop:12},
  issueMoneyInput:{minHeight:52,flexDirection:"row",alignItems:"center",paddingHorizontal:14,borderWidth:1,borderColor:"#e4dde7",borderRadius:15,backgroundColor:"#faf8fb"},
  issueMoneyPrefix:{color:"#211d24",fontSize:20,fontWeight:"900"},
  issueMoneyTextInput:{flex:1,paddingHorizontal:8,color:"#211d24",fontSize:20,fontWeight:"900"},
  issueSecurityNote:{flexDirection:"row",alignItems:"center",gap:8,padding:11,borderRadius:14,backgroundColor:"#eaf8f1"},
  issueSecurityText:{flex:1,color:"#087a50",fontSize:11,lineHeight:16,fontWeight:"700"},
  issueSubmitButton:{minHeight:50,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,borderRadius:16,backgroundColor:"#ff6a21"},
  issueSubmitText:{color:"#fff",fontSize:13,fontWeight:"900"},
  accountCard: {
    alignItems: "center",
    gap: 8,
    padding: 22,
    borderRadius: 24,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ebe7ed",
  },
  accountAvatar: {
    width: 74,
    height: 74,
    borderRadius: 28,
    backgroundColor: "#efe7ff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  accountInitial: { color: "#7c3cff", fontSize: 30, fontWeight: "900" },
  accountDetail: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderRadius: 15,
    backgroundColor: "#f7f5f8",
    marginTop: 5,
  },
  addressBookCard:{gap:14,padding:18,borderRadius:24,backgroundColor:"#fff",borderWidth:1,borderColor:"#ebe7ed"},
  addressBookHeading:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},
  savedAddressRow:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:11,paddingVertical:12,borderTopWidth:1,borderTopColor:"#f0edf2"},
  savedAddressIcon:{width:42,height:42,borderRadius:14,alignItems:"center",justifyContent:"center",backgroundColor:"#f0eaff"},
  savedAddressIconDefault:{backgroundColor:"#7c3cff"},
  savedAddressCopy:{flex:1,minWidth:180,gap:3},
  savedAddressTitle:{flexDirection:"row",alignItems:"center",gap:8},
  defaultAddressBadge:{paddingHorizontal:8,paddingVertical:3,color:"#6d35dc",backgroundColor:"#efe7ff",borderRadius:999,fontSize:10,fontWeight:"900",textTransform:"uppercase"},
  savedAddressActions:{flexDirection:"row",alignItems:"center",gap:13},
  newAddressForm:{gap:11,paddingTop:5},
  paymentMethodRow:{flexDirection:"row",alignItems:"center",gap:11,paddingVertical:12,borderTopWidth:1,borderTopColor:"#f0edf2"},
  paymentBrandRail:{gap:8,paddingVertical:2},
  paymentCompactFields:{flexDirection:"row",flexWrap:"wrap",gap:10},
  paymentCompactInput:{flex:1,minWidth:140},
  notificationBell:{width:42,height:42,borderRadius:15,backgroundColor:"#7c3cff",alignItems:"center",justifyContent:"center"},
  notificationRow:{flexDirection:"row",alignItems:"flex-start",gap:10,padding:13,borderRadius:17,backgroundColor:"#faf8fb"},
  notificationUnread:{backgroundColor:"#f3edff",borderWidth:1,borderColor:"#dfd0ff"},
  notificationStatusDot:{width:9,height:9,borderRadius:5,backgroundColor:"#7c3cff",marginTop:6},
  notificationTime:{fontSize:11,color:"#9c989f",marginTop:3},
  notificationNew:{fontSize:9,fontWeight:"900",color:"#7c3cff",letterSpacing:.8},
  notificationEmpty:{flexDirection:"row",alignItems:"center",gap:9,padding:14,borderRadius:16,backgroundColor:"#eefaf5"},
  preferenceGroup:{gap:9,paddingTop:8,borderTopWidth:1,borderTopColor:"#f0edf2"},
  preferenceRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingVertical:5},
  preferenceSwitch:{width:48,height:28,borderRadius:14,backgroundColor:"#ded9e1",padding:3},
  preferenceSwitchActive:{backgroundColor:"#7c3cff"},
  preferenceKnob:{width:22,height:22,borderRadius:11,backgroundColor:"#fff"},
  preferenceKnobActive:{alignSelf:"flex-end"},
  supportTicketCard:{gap:10,padding:14,borderRadius:18,backgroundColor:"#faf8fb",borderWidth:1,borderColor:"#ece7ef"},
  supportTicketHeader:{flexDirection:"row",alignItems:"flex-start",gap:8},
  supportSla:{fontSize:9,fontWeight:"900",letterSpacing:.7,color:"#087a50",backgroundColor:"#e5f8f0",paddingHorizontal:8,paddingVertical:5,borderRadius:9},
  supportSlaLate:{color:"#b3302c",backgroundColor:"#ffe9e7"},
  supportMessages:{gap:7},
  supportMessage:{maxWidth:"88%",paddingHorizontal:11,paddingVertical:8,borderRadius:14},
  supportMessageOwn:{alignSelf:"flex-end",backgroundColor:"#7c3cff"},
  supportMessageStaff:{alignSelf:"flex-start",backgroundColor:"#ece8ef"},
  supportMessageText:{fontSize:13,color:"#262128"},
  supportMessageTextOwn:{color:"#fff"},
  supportMessageTime:{fontSize:9,color:"#9c989f",marginTop:3},
  supportReplyRow:{flexDirection:"row",alignItems:"center",gap:8},
  supportReplyInput:{flex:1},
  supportSendButton:{width:44,height:44,borderRadius:14,backgroundColor:"#7c3cff",alignItems:"center",justifyContent:"center"},
  complianceCard:{gap:13,padding:17,borderRadius:22,backgroundColor:"#fff",borderWidth:1,borderColor:"#e9e4ec"},
  deliveryProofCard:{flexDirection:"row",alignItems:"center",gap:11,padding:14,borderRadius:18,backgroundColor:"#f7f1ff",borderWidth:1,borderColor:"#e3d3ff"},
  deliveryProofIcon:{width:40,height:40,borderRadius:13,alignItems:"center",justifyContent:"center",backgroundColor:"#7c3cff"},
  deliveryEvidenceBadge:{flexDirection:"row",alignItems:"center",gap:7,alignSelf:"flex-start",paddingHorizontal:10,paddingVertical:7,borderRadius:999,backgroundColor:"#e8f7f0"},
  deliveryEvidenceBadgeText:{fontSize:12,fontWeight:"800",color:"#087a50"},
  productCustomizerBackdrop:{flex:1,alignItems:"center",justifyContent:"flex-end",backgroundColor:"rgba(20,16,24,.48)"},
  productCustomizerSheet:{width:"100%",maxWidth:620,maxHeight:"88%",padding:18,paddingBottom:28,gap:14,borderTopLeftRadius:28,borderTopRightRadius:28,backgroundColor:"#fff"},
  productCustomizerContent:{gap:13,paddingBottom:10},
  dietaryBadgeRow:{flexDirection:"row",flexWrap:"wrap",gap:7},
  dietaryBadge:{flexDirection:"row",alignItems:"center",gap:5,backgroundColor:"#e9f8ef",borderRadius:999,paddingHorizontal:10,paddingVertical:7},
  dietaryBadgeText:{color:"#087a50",fontSize:12,fontWeight:"800"},
  dietaryPreferenceGrid:{flexDirection:"row",flexWrap:"wrap",gap:7,marginTop:8,marginBottom:14},
  dietaryPreferenceChip:{borderWidth:1,borderColor:"#ddd9e1",backgroundColor:"#fff",borderRadius:999,paddingHorizontal:11,paddingVertical:8},
  dietaryPreferenceChipActive:{backgroundColor:"#e9f8ef",borderColor:"#8ed5aa"},
  dietaryAllergenChipActive:{backgroundColor:"#fff0e6",borderColor:"#ffb47b"},
  dietaryPreferenceText:{fontSize:12,fontWeight:"800",color:"#6a6570"},
  dietaryPreferenceTextActive:{color:"#087a50"},
  dietaryAllergenTextActive:{color:"#a3480a"},
  dietarySafetyNote:{flexDirection:"row",alignItems:"flex-start",gap:8,backgroundColor:"#fff8eb",borderRadius:12,padding:10,marginTop:10},
  dietaryFilterBanner:{flexDirection:"row",alignItems:"center",gap:7,backgroundColor:"#e9f8ef",borderRadius:12,padding:10},
  searchStatus:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,padding:22,backgroundColor:"#f8f7f9",borderRadius:16},
  searchMatchText:{fontSize:11,color:"#8a6578",marginTop:3},
  searchMoreButton:{alignItems:"center",borderWidth:1,borderColor:"#ffb992",borderRadius:14,padding:13},
  searchMoreText:{color:"#d64c0b",fontWeight:"900"},
  orderConfirmationCard:{alignItems:"center",gap:8,backgroundColor:"#fff7ef",borderWidth:1,borderColor:"#ffd0af",borderRadius:24,padding:22,marginBottom:10},
  orderConfirmationIcon:{width:58,height:58,borderRadius:29,alignItems:"center",justifyContent:"center",backgroundColor:"#ff6a21",shadowColor:"#ff6a21",shadowOpacity:.25,shadowRadius:12},
  orderConfirmationEyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.4,color:"#d34b0d"},
  orderConfirmationAction:{width:"100%",flexDirection:"row",justifyContent:"center",alignItems:"center",gap:8,backgroundColor:"#211c24",borderRadius:14,padding:13,marginTop:6},
  orderConfirmationActionText:{color:"#fff",fontWeight:"900"},
  reorderButton:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,backgroundColor:"#ff6a21",borderRadius:13,padding:12,marginTop:12},
  reorderButtonText:{color:"#fff",fontWeight:"900"},
  trackingBackdrop:{flex:1,alignItems:"center",justifyContent:"flex-end",backgroundColor:"rgba(20,15,24,.48)"},
  trackingSheet:{width:"100%",maxWidth:620,maxHeight:"92%",backgroundColor:"#fff",borderTopLeftRadius:28,borderTopRightRadius:28,padding:18,gap:15},
  trackingHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  trackingMap:{height:260,borderRadius:20,overflow:"hidden",backgroundColor:"#e8e4ed"},
  nativeMapEmpty:{alignItems:"center",justifyContent:"center",gap:7,paddingHorizontal:26,borderWidth:1,borderColor:"#ded9e3"},
  nativeMapEmptyTitle:{color:"#17131c",fontSize:14,fontWeight:"900",textAlign:"center"},
  nativeMapEmptyText:{color:"#716a76",fontSize:11,fontWeight:"600",lineHeight:16,textAlign:"center"},
  trackingMapCaption:{position:"absolute",left:10,right:10,bottom:10,backgroundColor:"rgba(255,255,255,.94)",borderRadius:13,padding:10},
  trackingMapCaptionTitle:{fontSize:13,fontWeight:"900",color:"#252128"},
  trackingMapCaptionText:{fontSize:11,color:"#68616c",marginTop:2},
  trackingStatus:{gap:4},
  trackingProgress:{marginTop:12,gap:7},
  trackingStage:{flexDirection:"row",alignItems:"center",gap:9},
  trackingStageDot:{width:20,height:20,borderRadius:10,backgroundColor:"#e3dfe6",alignItems:"center",justifyContent:"center"},
  trackingStageDotActive:{backgroundColor:"#ff6a21"},
  trackingStageText:{fontSize:12,color:"#918b95"},
  trackingStageTextActive:{fontWeight:"900",color:"#252128"},
  shipmentProtectionCard:{flexDirection:"row",alignItems:"center",gap:10,borderWidth:1,borderColor:"#ded9e2",borderRadius:15,padding:11,backgroundColor:"#fff"},
  shipmentProtectionCardActive:{borderColor:"#73c894",backgroundColor:"#eefaf2"},
  shipmentProtectionIcon:{width:38,height:38,borderRadius:12,backgroundColor:"#087a50",alignItems:"center",justifyContent:"center"},
  shipmentOptionRail:{gap:9,paddingVertical:2},
  shipmentOptionCard:{minWidth:92,minHeight:70,borderRadius:17,borderWidth:1,borderColor:"#ded9e2",backgroundColor:"#fff",alignItems:"center",justifyContent:"center",gap:5,paddingHorizontal:12},
  shipmentOptionCardActive:{backgroundColor:"#7c3cff",borderColor:"#7c3cff"},
  shipmentOptionText:{color:"#5c5362",fontSize:12,fontWeight:"800"},
  shipmentOptionTextActive:{color:"#fff",fontSize:12,fontWeight:"900"},
  shipmentOptionMeta:{color:"#918898",fontSize:9,fontWeight:"700"},
  shipmentOptionMetaActive:{color:"#e5d9ff",fontSize:9,fontWeight:"700"},
  errorText:{color:"#b42318",fontSize:12,fontWeight:"700"},
  shipmentSlaGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},
  shipmentSlaCard:{width:"48%",borderRadius:16,borderWidth:1,borderColor:"#ded9e2",backgroundColor:"#fff",padding:12},
  shipmentSlaCardActive:{backgroundColor:"#17131c",borderColor:"#17131c"},
  shipmentSlaTitle:{color:"#231d27",fontWeight:"900"},
  shipmentSlaTitleActive:{color:"#fff",fontWeight:"900"},
  shipmentSlaCaption:{color:"#807785",fontSize:11,marginTop:2},
  shipmentSlaCaptionActive:{color:"#d7cedc",fontSize:11,marginTop:2},
  protectionQuoteText:{fontSize:12,fontWeight:"800",color:"#087a50",marginTop:5},
  returnStatusCard:{flexDirection:"row",alignItems:"center",gap:8,backgroundColor:"#f2edff",borderRadius:12,padding:11,marginTop:10},
  allergenWarning:{flexDirection:"row",gap:10,alignItems:"flex-start",backgroundColor:"#fff4df",borderWidth:1,borderColor:"#ffd69a",borderRadius:14,padding:12},
  allergenWarningTitle:{fontSize:13,fontWeight:"900",color:"#7c3b00"},
  allergenWarningText:{fontSize:12,lineHeight:18,color:"#7c4c20",paddingRight:25},
  modifierCounter:{paddingHorizontal:9,paddingVertical:5,borderRadius:999,overflow:"hidden",backgroundColor:"#fff0e8",color:"#c94c0b",fontSize:12,fontWeight:"900"},
  modifierRow:{minHeight:48,flexDirection:"row",alignItems:"center",gap:10,borderTopWidth:1,borderTopColor:"#eee8f0"},
  productNote:{minHeight:86,textAlignVertical:"top"},
  checkoutItem:{gap:3,paddingVertical:7,borderBottomWidth:1,borderBottomColor:"#eee8f0"},
  proofCameraButton:{minHeight:42,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6,paddingHorizontal:12,borderRadius:13,backgroundColor:"#18151d"},
  complianceHeader:{flexDirection:"row",alignItems:"flex-start",justifyContent:"space-between",gap:10},
  complianceBadge:{fontSize:9,fontWeight:"900",letterSpacing:.7,color:"#7c3cff",backgroundColor:"#efe7ff",paddingHorizontal:9,paddingVertical:6,borderRadius:10},
  complianceBadgeApproved:{color:"#087a50",backgroundColor:"#e5f8f0"},
  complianceBadgeRejected:{color:"#b3302c",backgroundColor:"#ffe9e7"},
  complianceDocuments:{gap:8},
  complianceDocumentRow:{flexDirection:"row",alignItems:"flex-start",gap:10,padding:11,borderRadius:15,backgroundColor:"#faf8fb"},
  complianceRejection:{fontSize:11,color:"#b3302c",fontWeight:"700"},
  newAddressFields:{flexDirection:"row",gap:8},
  addressLabelInput:{width:92},
  addressTextInput:{flex:1},
  primaryButton:{minHeight:48,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,paddingHorizontal:15,borderRadius:15,backgroundColor:"#7c3cff"},
  primaryButtonText:{color:"#fff",fontWeight:"900"},
  disabledButton:{opacity:.45},
  foodSearch: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 14,
    color: "#17131c",
    backgroundColor: "#fff",
  },
  foodChip: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2dee5",
    alignItems: "center",
    justifyContent: "center",
  },
  foodChipText:{color:flashDesign.color.inkSoft,fontSize:12,fontWeight:"800"},
  foodChipActive: { backgroundColor: "#ff6a21", borderColor: "#ff6a21" },
  foodChipTextActive: { color: "#fff" },
  foodCard: {
    padding: 14,
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e8e5eb",
    gap: 6,
  },
  foodMerchantCard:{overflow:"hidden",borderRadius:flashDesign.radius.surface,backgroundColor:flashDesign.color.surface,borderWidth:1,borderColor:flashDesign.color.line,shadowColor:flashDesign.color.ink,shadowOffset:{width:0,height:10},shadowOpacity:.08,shadowRadius:18,elevation:3},
  foodMerchantBody:{gap:10,paddingHorizontal:14,paddingTop:13,paddingBottom:15},
  foodMerchantTitleRow:{flexDirection:"row",alignItems:"flex-start",gap:12},
  foodMerchantName:{color:flashDesign.color.ink,fontSize:17,fontWeight:"900",letterSpacing:-.2},
  foodMerchantCuisine:{color:flashDesign.color.inkSoft,fontSize:11,marginTop:3},
  foodRatingPill:{flexDirection:"row",alignItems:"center",gap:4,paddingHorizontal:8,paddingVertical:6,borderRadius:flashDesign.radius.pill,backgroundColor:"#FFF5DC"},
  foodRatingText:{color:"#7B5800",fontSize:11,fontWeight:"900"},
  foodCardBanner: {
    height: 86,
    borderRadius: 16,
    backgroundColor: "#ffe1cc",
    justifyContent: "flex-start",
    padding: 10,
  },
  foodCardBannerLarge: {
    width:"100%",
    aspectRatio: 16/9,
    backgroundColor: "#ffe1cc",
    justifyContent: "flex-start",
    padding: 12,
  },
  foodMerchantBannerImage:{borderTopLeftRadius:flashDesign.radius.surface,borderTopRightRadius:flashDesign.radius.surface},
  foodCardBannerImage: { borderRadius: 16 },
  foodCardTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  foodCardPromo: {
    color: "#fff",
    backgroundColor: flashDesign.color.food,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
  },
  foodCardBadge: {
    color: "#17131c",
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "900",
  },
  shipmentHero: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: "#efe7ff",
  },
  shipmentHeroCopy: { marginTop: 7, color: "#655d70", lineHeight: 20 },
  shipmentBenefits: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  shipmentBenefit: {
    color: "#5d27aa",
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
  },
  hero: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#f4511e",
  },
  cardDark: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#161b22",
  },
  merchantHero:{padding:20,borderRadius:24,minHeight:174,justifyContent:"flex-end",overflow:"hidden"},
  merchantShell:{flex:1,backgroundColor:"#f6f3f0"},
  merchantContent:{padding:14,paddingBottom:30,width:"100%",maxWidth:560,alignSelf:"center"},
  merchantScreenHeading:{paddingTop:5,paddingBottom:5,gap:4},
  merchantScreenEyebrow:{color:"#ef641f",fontSize:10,fontWeight:"900",letterSpacing:1.3},
  merchantScreenTitle:{color:"#201b18",fontSize:27,fontWeight:"900",letterSpacing:-.7},
  merchantScreenCopy:{color:"#736962",fontSize:13,lineHeight:19},
  merchantOrderSummary:{flexDirection:"row",flexWrap:"wrap",gap:8},
  merchantOrderSummaryItem:{minWidth:"22%",flexGrow:1,padding:11,borderRadius:15,backgroundColor:"#241a14"},
  merchantOrderSummaryValue:{color:"#fff",fontSize:21,fontWeight:"900"},
  merchantOrderSummaryLabel:{marginTop:3,color:"rgba(255,255,255,.62)",fontSize:10,fontWeight:"800"},
  merchantEmpty:{minHeight:180,alignItems:"center",justifyContent:"center",gap:6,padding:20,borderRadius:22,backgroundColor:"#fff",borderWidth:1,borderColor:"#e7e1dc"},
  merchantEmptyTitle:{color:"#211c18",fontSize:18,fontWeight:"900"},
  merchantEmptyCopy:{color:"#756c65",fontSize:12,textAlign:"center"},
  merchantOrderActions:{flexDirection:"row",flexWrap:"wrap",gap:8},
  merchantOrderDetailAction:{flex:1,minHeight:44,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,borderRadius:14,backgroundColor:"#fff0e7",borderWidth:1,borderColor:"#ffd4bc"},
  merchantOrderDetailActionText:{color:"#9a3e12",fontSize:12,fontWeight:"900"},
  merchantDetailBackdrop:{flex:1,alignItems:"center",justifyContent:"flex-end",backgroundColor:"rgba(24,16,12,.58)"},
  merchantDetailSheet:{width:"100%",maxWidth:620,height:"94%",maxHeight:900,paddingHorizontal:18,paddingTop:9,paddingBottom:Math.max(18,Platform.OS==="ios"?26:18),borderTopLeftRadius:30,borderTopRightRadius:30,backgroundColor:"#f8f5f2"},
  merchantDetailHeading:{flex:1,gap:2},
  merchantDetailTitle:{color:"#211b17",fontSize:24,fontWeight:"900",letterSpacing:-.5},
  merchantDetailSubtitle:{color:"#766d66",fontSize:11,fontWeight:"700"},
  merchantDetailScroll:{flex:1},
  merchantDetailContent:{gap:13,paddingTop:14,paddingBottom:18},
  merchantDetailFacts:{flexDirection:"row",flexWrap:"wrap",gap:8},
  merchantDetailFact:{flex:1,minWidth:120,padding:10,borderRadius:14,backgroundColor:"#fff"},
  merchantDetailFactLabel:{color:"#8a7f77",fontSize:9,fontWeight:"800",textTransform:"uppercase"},
  merchantDetailFactValue:{marginTop:4,color:"#211b17",fontSize:14,fontWeight:"900"},
  merchantDetailSection:{gap:9,padding:14,borderRadius:20,backgroundColor:"#fff",borderWidth:1,borderColor:"#ebe4df"},
  merchantDetailSectionHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  merchantDetailSectionTitle:{color:"#211b17",fontSize:18,fontWeight:"900"},
  merchantDetailItem:{flexDirection:"row",alignItems:"flex-start",gap:10,paddingVertical:11,borderTopWidth:1,borderTopColor:"#eee8e3"},
  merchantDetailItemSelected:{marginHorizontal:-8,paddingHorizontal:8,borderRadius:14,backgroundColor:"#fff5ef",borderTopColor:"transparent"},
  merchantDetailQuantity:{width:34,height:34,alignItems:"center",justifyContent:"center",borderRadius:11,backgroundColor:"#211813"},
  merchantDetailQuantityText:{color:"#fff",fontSize:12,fontWeight:"900"},
  merchantDetailItemCopy:{flex:1,gap:4},
  merchantDetailItemTitleRow:{flexDirection:"row",alignItems:"center",gap:7},
  merchantDetailItemTitle:{flex:1,color:"#251f1b",fontSize:14,fontWeight:"900"},
  merchantDetailItemPrice:{color:"#ef641f",fontSize:11,fontWeight:"900"},
  merchantDetailItemMeta:{color:"#766d66",fontSize:11,lineHeight:16},
  merchantUnavailableBadge:{paddingHorizontal:7,paddingVertical:4,borderRadius:8,overflow:"hidden",color:"#a33b28",backgroundColor:"#ffe8e2",fontSize:8,fontWeight:"900"},
  merchantKitchenNote:{flexDirection:"row",alignItems:"flex-start",gap:6,padding:9,borderRadius:11,backgroundColor:"#fff1e8"},
  merchantKitchenNoteText:{flex:1,color:"#7c3c1c",fontSize:11,fontWeight:"700",lineHeight:16},
  merchantSubstitutionTrigger:{alignSelf:"flex-start",minHeight:38,flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:11,borderRadius:12,backgroundColor:"#fff0e7",borderWidth:1,borderColor:"#ffd4bc"},
  merchantSubstitutionTriggerText:{color:"#9a3e12",fontSize:11,fontWeight:"900"},
  merchantSubstitutionComposer:{gap:11,padding:15,borderRadius:22,backgroundColor:"#fff",borderWidth:2,borderColor:"#ffcfb4"},
  merchantReplacementList:{gap:7},
  merchantReplacementOption:{minHeight:58,flexDirection:"row",alignItems:"center",gap:9,padding:10,borderRadius:15,backgroundColor:"#faf7f5",borderWidth:1,borderColor:"#e8e1dc"},
  merchantReplacementOptionActive:{backgroundColor:"#fff0e7",borderColor:"#ef641f"},
  merchantReplacementRadio:{width:18,height:18,alignItems:"center",justifyContent:"center",borderRadius:999,borderWidth:2,borderColor:"#ef641f"},
  merchantReplacementRadioDot:{width:8,height:8,borderRadius:999,backgroundColor:"#ef641f"},
  merchantRecommendedBadge:{paddingHorizontal:6,paddingVertical:4,borderRadius:8,overflow:"hidden",color:"#18704b",backgroundColor:"#e6f6ee",fontSize:7,fontWeight:"900"},
  merchantSubstitutionHistory:{gap:5,padding:11,borderRadius:14,backgroundColor:"#f8f5f3"},
  merchantSubstitutionStatus:{alignSelf:"flex-start",paddingHorizontal:7,paddingVertical:4,borderRadius:8},
  merchantSubstitutionPending:{backgroundColor:"#fff0d9"},
  merchantSubstitutionAccepted:{backgroundColor:"#dcf6e8"},
  merchantSubstitutionRejected:{backgroundColor:"#f5e8e5"},
  merchantSubstitutionStatusText:{color:"#493c35",fontSize:8,fontWeight:"900"},
  merchantRefundText:{color:"#13744d",fontSize:11,fontWeight:"900"},
  merchantDetailError:{flexDirection:"row",alignItems:"flex-start",gap:8,padding:11,borderRadius:13,backgroundColor:"#fff0ec"},
  merchantDetailErrorText:{flex:1,color:"#8e3322",fontSize:11,fontWeight:"700",lineHeight:16},
  merchantDetailDelivery:{flexDirection:"row",alignItems:"flex-start",gap:10,padding:14,borderRadius:18,backgroundColor:"#f1edff"},
  merchantDetailChat:{minHeight:48,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,borderRadius:15,backgroundColor:"#7c3cff"},
  merchantAccountCard:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:12,padding:16,borderRadius:20,backgroundColor:"#211813"},
  merchantAccountIcon:{width:46,height:46,borderRadius:15,alignItems:"center",justifyContent:"center",backgroundColor:"#ef641f"},
  merchantAccountCopy:{flex:1,gap:3},
  merchantAccountTitle:{color:"#211c18",fontSize:14,fontWeight:"900"},
  merchantAccountDetail:{color:"#756c65",fontSize:11,lineHeight:16},
  merchantAccountStatus:{paddingHorizontal:9,paddingVertical:6,borderRadius:999,overflow:"hidden",fontSize:10,fontWeight:"900"},
  merchantAccountStatusOpen:{color:"#b9f4d2",backgroundColor:"rgba(45,177,108,.18)"},
  merchantAccountStatusPaused:{color:"#ffd0b6",backgroundColor:"rgba(239,100,31,.18)"},
  merchantAccountCardTitle:{color:"#fff",fontSize:14,fontWeight:"900"},
  merchantAccountCardDetail:{color:"rgba(255,255,255,.6)",fontSize:11,lineHeight:16},
  merchantBranchRow:{flexDirection:"row",alignItems:"flex-start",gap:11,paddingVertical:11,borderBottomWidth:1,borderBottomColor:"#eee8e3"},
  merchantBranchPin:{width:38,height:38,borderRadius:13,alignItems:"center",justifyContent:"center"},
  merchantBranchPinOpen:{backgroundColor:"#e4f7ed"},
  merchantBranchPinClosed:{backgroundColor:"#fff0e6"},
  merchantBranchMeta:{marginTop:3,color:"#ef641f",fontSize:10,fontWeight:"800"},
  merchantDataCard:{flexDirection:"row",alignItems:"flex-start",gap:11,padding:15,borderRadius:18,backgroundColor:"#edf8f2",borderWidth:1,borderColor:"#cce9da"},
  merchantBottomNav:{minHeight:72,flexDirection:"row",alignItems:"center",justifyContent:"space-around",paddingHorizontal:8,paddingTop:7,paddingBottom:Math.max(8,Platform.OS==="ios"?12:8),backgroundColor:"#fff",borderTopWidth:1,borderTopColor:"#e7e0db",shadowColor:"#382116",shadowOpacity:.12,shadowRadius:14,shadowOffset:{width:0,height:-4},elevation:16},
  merchantBottomItem:{flex:1,minHeight:52,alignItems:"center",justifyContent:"center",gap:3,borderRadius:16,outlineWidth:0,outlineStyle:"solid"},
  merchantBottomItemActive:{backgroundColor:"#fff3ec"},
  merchantBottomIconWrap:{position:"relative",minWidth:30,alignItems:"center"},
  merchantBottomDot:{position:"absolute",top:-1,right:1,width:7,height:7,borderRadius:999,backgroundColor:"#d94a31",borderWidth:1,borderColor:"#fff"},
  merchantBottomLabel:{color:"#8b817b",fontSize:10,fontWeight:"800"},
  merchantBottomLabelActive:{color:"#ef641f"},
  merchantHeroTopline:{position:"absolute",top:18,left:20,right:20,flexDirection:"row",alignItems:"center",gap:8},
  merchantLiveDot:{width:9,height:9,borderRadius:999},
  merchantLiveDotOpen:{backgroundColor:"#64e49d"},
  merchantLiveDotPaused:{backgroundColor:"#ff9453"},
  merchantHeroMeta:{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:14},
  merchantHeroMetaText:{paddingHorizontal:10,paddingVertical:6,borderRadius:999,overflow:"hidden",color:"#fff",backgroundColor:"rgba(255,255,255,.12)",fontSize:11,fontWeight:"800"},
  merchantSync:{minHeight:66,paddingHorizontal:14,paddingVertical:11,borderRadius:18,borderWidth:1,flexDirection:"row",alignItems:"center",gap:12},
  merchantSyncLive:{backgroundColor:"#f1fbf5",borderColor:"#c8ebd5"},
  merchantSyncError:{backgroundColor:"#fff2ef",borderColor:"#f2c7bd"},
  merchantSyncCopy:{flex:1,gap:3},
  merchantSyncTitle:{color:"#201b18",fontSize:13,fontWeight:"900"},
  merchantSyncDetail:{color:"#716862",fontSize:11,lineHeight:16},
  merchantSyncButton:{width:36,height:36,borderRadius:999,alignItems:"center",justifyContent:"center",backgroundColor:"#fff",borderWidth:1,borderColor:"#eaded7"},
  merchantPulseCard:{padding:16,borderRadius:22,backgroundColor:"#fff",borderWidth:1,borderColor:"#ebe6e2",gap:14,shadowColor:"#3a2315",shadowOpacity:.06,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:2},
  merchantPulseHeader:{flexDirection:"row",alignItems:"flex-start",justifyContent:"space-between",gap:10},
  merchantPulseEyebrow:{color:"#f06720",fontSize:10,fontWeight:"900",letterSpacing:1.2},
  merchantPulseTitle:{marginTop:3,color:"#201b18",fontSize:18,fontWeight:"900"},
  merchantPulseTotal:{color:"#756b65",fontSize:11,fontWeight:"800"},
  merchantPulseGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},
  merchantPulseStage:{minWidth:"30%",flexGrow:1,padding:11,borderRadius:15,backgroundColor:"#f7f4f1"},
  merchantPulseStageValue:{color:"#261d18",fontSize:21,fontWeight:"900"},
  merchantPulseStageLabel:{marginTop:2,color:"#766d67",fontSize:10,fontWeight:"800"},
  merchantSlaAlert:{flexDirection:"row",alignItems:"flex-start",gap:8,padding:11,borderRadius:14,backgroundColor:"#fff0ec"},
  merchantSlaAlertText:{flex:1,color:"#93301f",fontSize:12,fontWeight:"700",lineHeight:17},
  heroLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  heroTitle: {
    marginTop: 6,
    color: "#fff",
    fontSize: 21,
    fontWeight: "900",
  },
  heroCopy: {
    marginTop: 6,
    color: "rgba(255,255,255,0.76)",
    lineHeight: 20,
  },
  gpsText: {
    marginTop: 8,
    color: "#8df0c3",
    fontSize: 12,
    fontWeight: "900",
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  kpi: {
    width: "47.8%",
    minHeight: 84,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e9ef",
  },
  kpiLabel: {
    color: "#626a78",
    fontSize: 12,
    fontWeight: "900",
  },
  kpiValue: {
    marginTop: 10,
    color: "#222832",
    fontSize: 22,
    fontWeight: "900",
  },
  sectionTitle: {
    color: "#222832",
    fontSize: 17,
    fontWeight: "900",
  },
  card: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e9ef",
    gap: 5,
  },
  cardTitle: {
    color: "#222832",
    fontSize: 16,
    fontWeight: "900",
  },
  cardText: {
    color: "#626a78",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eef0f3",
  },
  itemCopy: {
    flex: 1,
    gap: 3,
  },
  itemName: {
    color: "#222832",
    fontWeight: "800",
  },
  formCard: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e9ef",
    gap: 10,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d8dde5",
    borderRadius: 8,
    paddingHorizontal: 12,
    color: "#222832",
    backgroundColor: "#fff",
  },
  secondaryAction: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f4511e",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionText: {
    color: "#d74317",
    fontWeight: "800",
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choice: {
    minWidth: 70,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#eef0f3",
    alignItems: "center",
    justifyContent: "center",
  },
  choiceActive: {
    backgroundColor: "#f4511e",
  },
  choiceText: {
    color: "#626a78",
    fontWeight: "800",
    textTransform: "capitalize",
  },
  choiceTextActive: {
    color: "#fff",
  },
  helperText: {
    color: "#627080",
    fontSize: 12,
  },
  quoteBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#e8f7ef",
    gap: 4,
  },
  rideHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  rideEyebrow: {
    color: "#7c3cff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  rideTitle: {
    color: "#15131a",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 3,
  },
  livePill: {
    backgroundColor: "#eaf9f1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  livePillText: {
    color: "#087a4b",
    fontSize: 12,
    fontWeight: "900",
  },
  navigationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 13,
    borderRadius: 19,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5dfeb",
    shadowColor: "#32115d",
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  navigationTurn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#7c3cff",
    alignItems: "center",
    justifyContent: "center",
  },
  navigationLabel: {
    color: "#7c3cff",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  navigationInstruction: {
    color: "#17131c",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
  },
  navigationNext: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "#f0e7ff",
    alignItems: "center",
    justifyContent: "center",
  },
  driverShell: {
    flex: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    backgroundColor: "#f7f6f9",
  },
  driverContent: { padding: 14, paddingBottom: 26, gap: 12 },
  driverAppHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  driverBrand: { color: "#7c3cff", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  driverGreeting: { color: "#17131c", fontSize: 25, fontWeight: "900", marginTop: 2 },
  driverHeaderAction: { width: 42, height: 42, borderRadius: 15, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#ebe5ef" },
  driverBottomNav: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 8, paddingTop: 7, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e6e0e9", shadowColor: "#241331", shadowOpacity: .12, shadowRadius: 14, shadowOffset: {width:0,height:-4}, elevation: 16 },
  driverBottomItem: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 3 },
  driverBottomIconWrap: { position: "relative", minWidth: 25, alignItems: "center" },
  driverBottomDot: { position: "absolute", right: -2, top: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef3b57", borderWidth: 1.5, borderColor: "#fff" },
  driverBottomLabel: { color: "#8a828f", fontSize: 10, fontWeight: "800" },
  driverBottomLabelActive: { color: "#7c3cff" },
  driverEarningsHero: { minHeight: 185, borderRadius: 28, padding: 22, justifyContent: "center", shadowColor: "#35115f", shadowOpacity: .2, shadowRadius: 18, shadowOffset: {width:0,height:8}, elevation: 6 },
  driverEarningsLabel: { color: "rgba(255,255,255,.68)", fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  driverEarningsValue: { color: "#fff", fontSize: 38, fontWeight: "900", marginTop: 9 },
  driverEarningsCopy: { color: "rgba(255,255,255,.78)", fontSize: 12, lineHeight: 18, marginTop: 10, maxWidth: 360 },
  driverEarningsError: { flexDirection: "row", alignItems: "center", gap: 11, padding: 14, borderRadius: 18, backgroundColor: "#fff0ef", borderWidth: 1, borderColor: "#f1cfcc" },
  driverPeriodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  driverPeriodCard: { flex: 1, minWidth: 150, minHeight: 112, borderRadius: 21, padding: 15, justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#e9e3ed" },
  driverPeriodLabel: { color: "#7c3cff", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  driverPeriodValue: { color: "#17131c", fontSize: 21, fontWeight: "900", marginTop: 8 },
  driverPeriodMeta: { color: "#77707b", fontSize: 10, fontWeight: "700", marginTop: 5 },
  driverWeekChartCard: { borderRadius: 25, padding: 18, gap: 13, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e9e3ed" },
  driverWeekChartTotal: { color: "#17131c", fontSize: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  driverWeekChart: { minHeight: 146, flexDirection: "row", alignItems: "flex-end", gap: 5 },
  driverWeekColumn: { flex: 1, minWidth: 0, alignItems: "center" },
  driverWeekColumnSelected: { backgroundColor: "#f2eaff", borderRadius: 10 },
  driverWeekAmount: { color: "#5f5764", fontSize: 8, fontWeight: "800", marginBottom: 4, fontVariant: ["tabular-nums"] },
  driverWeekAmountNegative: { color: "#a33939" },
  driverWeekUpper: { width: "100%", height: 54, alignItems: "center", justifyContent: "flex-end" },
  driverWeekLower: { width: "100%", height: 54, alignItems: "center", justifyContent: "flex-start" },
  driverWeekBar: { width: "58%", maxWidth: 24, minWidth: 7, borderTopLeftRadius: 7, borderTopRightRadius: 7 },
  driverWeekBaseline: { width: "100%", height: 1, backgroundColor: "#d8d1dc" },
  driverWeekDay: { color: "#817985", fontSize: 8, fontWeight: "900", marginTop: 5 },
  driverWeekDaySelected: { color: "#7c3cff" },
  driverWeekDetail: { gap: 11, padding: 13, borderRadius: 18, backgroundColor: "#f8f6fa" },
  driverWeekDetailHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  driverWeekDetailDate: { color: "#17131c", fontSize: 14, fontWeight: "900", marginTop: 3 },
  driverWeekDetailAmount: { color: "#17131c", fontSize: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  driverWeekDetailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  driverWeekDetailMetric: { width: "48%", minHeight: 54, padding: 9, borderRadius: 13, backgroundColor: "#fff" },
  driverWeekDetailValue: { color: "#28222c", fontSize: 13, fontWeight: "900", marginTop: 5, fontVariant: ["tabular-nums"] },
  driverTimeCard: { borderRadius: 25, padding: 18, gap: 15, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e9e3ed", shadowColor: "#2b1738", shadowOpacity: .06, shadowRadius: 16, shadowOffset: {width:0,height:7}, elevation: 2 },
  driverTimeTitle: { color: "#17131c", fontSize: 22, fontWeight: "900", marginTop: 3 },
  driverTimeClock: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#f0e7ff" },
  driverTimeGrid: { flexDirection: "row", gap: 10 },
  driverTimeMetric: { flex: 1, minWidth: 0, minHeight: 105, padding: 14, borderRadius: 19, backgroundColor: "#f8f6fa" },
  driverTimeMetricTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  driverTimeDot: { width: 8, height: 8, borderRadius: 4 },
  driverTimeLabel: { color: "#6f6874", fontSize: 9, fontWeight: "900", letterSpacing: .8 },
  driverTimeValue: { color: "#17131c", fontSize: 22, fontWeight: "900", marginTop: 12, fontVariant: ["tabular-nums"] },
  driverTimeMeta: { color: "#77707b", fontSize: 10, fontWeight: "600", marginTop: 5 },
  driverTimeRatio: { gap: 7 },
  driverTimeTrack: { height: 7, borderRadius: 4, overflow: "hidden", backgroundColor: "#e9e3ed" },
  driverTimeFill: { height: "100%", minWidth: 3, borderRadius: 4, backgroundColor: "#087a50" },
  driverTimeRatioText: { color: "#5e5663", fontSize: 10, fontWeight: "700" },
  driverTimeWarning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, borderRadius: 14, backgroundColor: "#fff6e8" },
  driverTimeWarningText: { flex: 1, color: "#80500b", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  driverTimeWeek: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingTop: 2 },
  driverTimeWeekLabel: { color: "#7c3cff", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  driverTimeWeekValue: { color: "#3e3742", fontSize: 11, fontWeight: "800" },
  driverTimeWeekDivider: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#aaa1af" },
  driverTimeSource: { color: "#89818d", fontSize: 9, lineHeight: 14, fontWeight: "600" },
  driverTimeUnavailable: { flexDirection: "row", alignItems: "flex-start", gap: 11, padding: 15, borderRadius: 20, backgroundColor: "#fff0ef", borderWidth: 1, borderColor: "#f1cfcc" },
  driverEarningRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eee9f1" },
  driverEarningAdjustment: { backgroundColor: "#fff0ef" },
  driverEarningAmount: { color: "#087a50", fontSize: 14, fontWeight: "900", fontVariant: ["tabular-nums"] },
  driverEarningAmountNegative: { color: "#a33939" },
  driverPreferenceOptions: { gap: 9, marginTop: 4 },
  driverPreferenceOption: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: 17, borderWidth: 1, borderColor: "#e8e1ec", backgroundColor: "#faf9fb" },
  driverPreferenceOptionActive: { borderColor: "#7c3cff", backgroundColor: "#f5efff" },
  driverPreferenceRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#a39aa8", alignItems: "center", justifyContent: "center" },
  driverPreferenceRadioActive: { borderColor: "#7c3cff" },
  driverPreferenceDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#7c3cff" },
  driverDemandLoading:{minHeight:120,alignItems:"center",justifyContent:"center",gap:10,padding:18,borderRadius:22,backgroundColor:"#fff",borderWidth:1,borderColor:"#e9e3ed"},
  driverDemandError:{minHeight:76,flexDirection:"row",alignItems:"center",gap:11,padding:14,borderRadius:18,backgroundColor:"#fff5f2",borderWidth:1,borderColor:"#f0d6d0"},
  driverDemandRail:{gap:10,paddingVertical:2,paddingRight:14},
  driverDemandCard:{width:194,minHeight:132,gap:5,padding:14,borderRadius:20,backgroundColor:"#fff",borderWidth:1,borderColor:"#e8e1ec"},
  driverDemandCardCurrent:{borderColor:"#7c3cff",borderWidth:2,backgroundColor:"#faf7ff"},
  driverDemandCardTop:{minHeight:19,flexDirection:"row",alignItems:"center",gap:6},driverDemandLevelDot:{width:8,height:8,borderRadius:4},driverDemandLevel:{fontSize:9,fontWeight:"900",letterSpacing:1},driverDemandHere:{marginLeft:"auto",color:"#7c3cff",fontSize:8,fontWeight:"900",letterSpacing:.8},
  driverDemandName:{color:"#17131c",fontSize:20,fontWeight:"900",marginTop:2},driverDemandJobs:{color:"#37303b",fontSize:12,fontWeight:"800",marginTop:3},driverDemandSupply:{color:"#77707b",fontSize:10,fontWeight:"700"},
  driverInsightCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 21, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e9e3ed" },
  driverInsightIcon: { width: 46, height: 46, borderRadius: 16, backgroundColor: "#f0e7ff", alignItems: "center", justifyContent: "center" },
  driverTransparencyCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 21, backgroundColor: "#eaf8f0", borderWidth: 1, borderColor: "#cdebd9" },
  driverSectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 4 },
  driverSectionEyebrow: { color: "#7c3cff", fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  driverSectionTitle: { color: "#17131c", fontSize: 28, fontWeight: "900", marginTop: 3 },
  driverUnreadBadge: { minWidth: 36, height: 36, paddingHorizontal: 10, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#7c3cff" },
  driverUnreadText: { color: "#fff", fontWeight: "900", fontVariant: ["tabular-nums"] },
  driverInboxRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#eee9f1" },
  driverInboxUnread: { backgroundColor: "#f7f1ff", marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 14 },
  driverInboxIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#f0e8ff", alignItems: "center", justifyContent: "center" },
  driverEmptyState: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 7, padding: 20 },
  driverNavScreen: { flex: 1, backgroundColor: "#15121a" },
  driverNavTop: { minHeight: 108, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#15121a" },
  driverNavClose: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.12)" },
  driverNavTurn: { width: 58, height: 58, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#caff3d" },
  driverNavPhase: { color: "#caff3d", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  driverNavInstruction: { color: "#fff", fontSize: 18, lineHeight: 22, fontWeight: "900", marginTop: 4 },
  driverNavDistance: { color: "rgba(255,255,255,.7)", fontSize: 12, fontWeight: "800", marginTop: 3 },
  driverNavSheet: { flex: 1, backgroundColor: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26, marginTop: -22 },
  driverNavSheetContent: { padding: 18, paddingTop: 22, paddingBottom: 34, gap: 12 },
  driverNavEtaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  driverNavEta: { color: "#17131c", fontSize: 31, fontWeight: "900" },
  driverNavKind: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  driverNavDestinationLabel: { color: "#7c3cff", fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginTop: 3 },
  driverNavDestination: { color: "#17131c", fontSize: 17, lineHeight: 22, fontWeight: "900" },
  driverNavStep: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 54, paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#eee9f1" },
  driverNavStepIndex: { width: 31, height: 31, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#6f6874" },
  driverNavStepIndexText: { color: "#fff", fontWeight: "900" },
  driverNavStepText: { color: "#241f29", fontSize: 14, fontWeight: "800" },
  driverNavActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  driverNavSecondary: { minHeight: 52, paddingHorizontal: 18, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#f0edf2" },
  driverNavSecondaryText: { color: "#17131c", fontWeight: "900" },
  driverNavPrimary: { flex: 1, minHeight: 52, paddingHorizontal: 14, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#17131c" },
  driverNavDisclaimer: { color: "#766e7b", fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 2 },
  driverNavigation: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f4edff",
    borderWidth: 2,
    borderColor: "#7c3cff",
  },
  dispatchOffer: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#ebe7f3",
    shadowColor: "#251445",
    shadowOpacity: 0.09,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  dispatchOfferHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  dispatchOfferIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: "#7c3cff",
    alignItems: "center",
    justifyContent: "center",
  },
  dispatchOfferType: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    color: "#7c3cff",
  },
  dispatchOfferTimer: {
    fontSize: 20,
    fontWeight: "900",
    color: "#17131d",
    fontVariant: ["tabular-nums"],
  },
  dispatchOfferFare: { fontSize: 19, fontWeight: "900", color: "#17131d" },
  dispatchRoute: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 5,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#27ae60",
    borderWidth: 2,
    borderColor: "#d8f7e5",
  },
  routeDotDestination: { backgroundColor: "#7c3cff", borderColor: "#e7dcff" },
  dispatchAddress: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#312b39",
  },
  offerActions: { flexDirection: "row", gap: 10, marginTop: 2 },
  rejectOfferButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ded7e8",
    alignItems: "center",
    justifyContent: "center",
  },
  rejectOfferText: { fontWeight: "800", color: "#5f5669" },
  acceptOfferButton: {
    flex: 2,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#17131d",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptOfferText: { fontWeight: "900", color: "#fff" },
  quickPlacesRail: { gap: 9, paddingBottom: 2 },
  quickPlace: {
    width: 180,
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 9,
    borderRadius: 17,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e7e3eb",
  },
  quickPlaceIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "#f0e8ff",
    alignItems: "center",
    justifyContent: "center",
  },
  quickPlaceCopy:{flex:1,minWidth:0},
  quickPlaceEmpty:{width:220,minHeight:62,flexDirection:"row",alignItems:"center",gap:9,padding:12,borderRadius:17,backgroundColor:"#f7f2ff",borderWidth:1,borderColor:"#e3d8f4"},
  quickPlaceTitle: { color: "#17131c", fontSize: 12, fontWeight: "900" },
  quickPlaceAddress: {
    color: "#77717c",
    fontSize: 10,
    marginTop: 2,
    maxWidth: 112,
  },
  rideSheet: {
    padding: 14,
    marginTop: -28,
    marginHorizontal: 8,
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e7e3eb",
    gap: 10,
  },
  rideOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#f7f5f9",
  },
  rideOptionActive: { borderColor: "#7c3cff", backgroundColor: "#f3ecff" },
  vehicleBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#17131c",
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleIcon: { color: "#fff", fontSize: 14, fontWeight: "900" },
  rideOptionCopy: { flex: 1 },
  rideOptionTitle: { color: "#17131c", fontSize: 15, fontWeight: "900" },
  ridePrice: { color: "#17131c", fontSize: 15, fontWeight: "900" },
  routeSummary: {
    color: "#5f5868",
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
  },
  fareBreakdown: {
    padding: 13,
    borderRadius: 17,
    backgroundColor: "#f8f6fa",
    borderWidth: 1,
    borderColor: "#e9e4ed",
    gap: 7,
  },
  fareBreakdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  fareTotal: { color: "#17131c", fontSize: 20, fontWeight: "900" },
  fareLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  demandText: { color: "#7c3cff", fontSize: 12, fontWeight: "900" },
  safetyStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 13,
    borderRadius: 18,
    backgroundColor: "#eefaf4",
    borderWidth: 1,
    borderColor: "#d4f0e2",
  },
  safetyIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  safetyTitle: { color: "#164c36", fontWeight: "900", marginBottom: 2 },
  totalText: {
    color: "#222832",
    fontWeight: "900",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "#252b33",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionDisabled: {
    opacity: 0.55,
  },
  actionText: {
    color: "#fff",
    fontWeight: "900",
    textAlign: "center",
    flexShrink: 1,
  },
  signatureBackdrop:{flex:1,alignItems:"center",backgroundColor:"rgba(20,16,24,.48)",justifyContent:"flex-end"},
  signatureSheet:{width:"100%",maxWidth:620,backgroundColor:"#fff",borderTopLeftRadius:28,borderTopRightRadius:28,padding:20,paddingBottom:32,gap:14},
  signatureRelationshipRow:{flexDirection:"row",gap:8},
  signatureChoice:{flex:1,minHeight:42,borderRadius:14,borderWidth:1,borderColor:"#ded9e2",alignItems:"center",justifyContent:"center",paddingHorizontal:8},
  signatureChoiceActive:{backgroundColor:"#17131c",borderColor:"#17131c"},
  signatureChoiceText:{fontWeight:"800",fontSize:12,color:"#5f5864",textAlign:"center"},
  signatureChoiceTextActive:{fontWeight:"800",fontSize:12,color:"#fff",textAlign:"center"},
  signatureCanvas:{height:210,borderRadius:18,borderWidth:1.5,borderColor:"#cbc4d0",borderStyle:"dashed",backgroundColor:"#fff",overflow:"hidden",alignItems:"center",justifyContent:"center"},
  signatureGuide:{color:"#aaa1ae",fontWeight:"700",fontSize:16},
  signatureActions:{flexDirection:"row",gap:10},
  shipmentTrackingSummary:{marginTop:12,padding:15,borderRadius:18,backgroundColor:"#f6f2f8",flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},
  shipmentTrackingBadge:{width:44,height:44,borderRadius:15,backgroundColor:"#7c3cff",alignItems:"center",justifyContent:"center"},
  shipmentPinCard:{marginTop:12,borderRadius:18,backgroundColor:"#17131c",padding:16,alignItems:"center"},
  shipmentPin:{color:"#fff",fontSize:34,fontWeight:"900",letterSpacing:8,marginVertical:4},
  referralCode:{color:"#fff",fontSize:24,fontWeight:"900",letterSpacing:3,marginVertical:6,textAlign:"center"},
  secondaryButton:{minHeight:50,paddingHorizontal:22,borderRadius:16,borderWidth:1,borderColor:"#d7d0dc",alignItems:"center",justifyContent:"center",backgroundColor:"#fff"},
  secondaryButtonText:{color:"#342e38",fontWeight:"900"},
});
