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
  SafeAreaView,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "./src/api";
import { configureAnalytics, track } from "./src/analytics";
import FlashNativeMap from "./src/FlashNativeMap";
import { buildExternalNavigationUrl } from "./src/navigation-links";
import {getBackgroundLocationState,startDriverBackgroundLocation,stopDriverBackgroundLocation,type BackgroundLocationState} from "./src/background-location";
import type {
  AppState,
  DispatchOffer,
  Driver,
  DriverCompliance,
  DriverDocument,
  DriverVehicle,
  FoodCheckoutQuote,
  GeoPoint,
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
  const stages:Ride["status"][]=["requested","driver_assigned","arriving","in_progress","completed"],labels=["Buscando conductor","Conductor asignado","Llegando a buscarte","Viaje en curso","Llegaste"],current=Math.max(0,stages.indexOf(ride.status)),headline=labels[current]||ride.status.replaceAll("_"," "),nextStep=route?.steps[0]?navigationInstruction(route.steps[0]):null;
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.trackingBackdrop}><View style={styles.trackingSheet}><View style={styles.trackingHeader}><View><Text style={styles.orderConfirmationEyebrow}>VIAJE EN VIVO</Text><Text style={styles.foodRestaurantTitle}>{headline}</Text></View><Pressable style={styles.foodBack} onPress={onClose}><Ionicons name="close" size={21} color="#222"/></Pressable></View>{hasMap?<FlashNativeMap origin={ride.pickupLocation!} destination={ride.destinationLocation!} route={route?.coordinates||[]} driver={driver?.location||null} routeColor="#7c3cff" caption={route?`${route.distanceKm} km · ${route.durationMin} min`:routeError||"Calculando ruta real…"} detail={driver?`${driver.name} · ${driver.vehicle}`:"Buscando un conductor disponible"} accessibilityLabel="Mapa interactivo del viaje"/>:<NativeMapUnavailable message={routeError||"El origen o el destino todavía no tienen coordenadas verificadas."}/>}<ScrollView showsVerticalScrollIndicator={false}><View style={styles.trackingStatus}><Text style={styles.foodRestaurantTitle}>{headline}</Text><Text style={styles.cardText}>{ride.pickup} → {ride.destination}</Text>{nextStep&&ride.status==="in_progress"?<View style={styles.returnStatusCard}><Ionicons name="navigate" size={18} color="#7c3cff"/><Text style={styles.cardText}>{nextStep}</Text></View>:null}<View style={styles.trackingProgress}>{labels.map((label,index)=><View style={styles.trackingStage} key={label}><View style={[styles.trackingStageDot,index<=current&&styles.trackingStageDotActive]}>{index<current?<Ionicons name="checkmark" size={11} color="#fff"/>:null}</View><Text style={[styles.trackingStageText,index===current&&styles.trackingStageTextActive]}>{label}</Text></View>)}</View></View>{driver?<View style={styles.shipmentTrackingSummary}><View><Text style={styles.orderConfirmationEyebrow}>TU CONDUCTOR</Text><Text style={styles.sectionTitle}>{driver.name}</Text><Text style={styles.cardText}>{driver.vehicle} · ★ {driver.rating.toFixed(1)}</Text></View><View style={styles.shipmentTrackingBadge}><Ionicons name="car-sport" size={20} color="#fff"/></View></View>:null}{["driver_assigned","arriving"].includes(ride.status)?<View style={styles.shipmentPinCard}><Text style={styles.orderConfirmationEyebrow}>PIN PARA INICIAR</Text>{pickupCode?<><Text style={styles.shipmentPin}>{pickupCode}</Text><Text style={styles.helperText}>Decíselo al conductor sólo cuando estés junto al vehículo correcto.</Text></>:<Pressable style={styles.orderConfirmationAction} onPress={()=>void onRevealCode()}><Ionicons name="key-outline" size={18} color="#fff"/><Text style={styles.orderConfirmationActionText}>Mostrar PIN seguro</Text></Pressable>}</View>:null}<View style={styles.safetyStrip}><View style={styles.safetyIcon}><Ionicons name="shield-checkmark" size={21} color="#087a4b"/></View><View style={styles.itemCopy}><Text style={styles.safetyTitle}>Centro de seguridad</Text><Text style={styles.helperText}>Compartí tu ruta o enviá una alerta vinculada a este viaje.</Text></View></View><Pressable style={styles.orderConfirmationAction} onPress={()=>onShare()}><Ionicons name="share-social-outline" size={18} color="#fff"/><Text style={styles.orderConfirmationActionText}>Compartir seguimiento seguro</Text></Pressable>{contacts.length>0?<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{contacts.map(contact=><Pressable key={contact.id} style={styles.issueCategoryPill} onPress={()=>onShare(contact)}><Ionicons name="person-outline" size={15} color="#7c3cff"/><Text style={styles.issueCategoryText}>{contact.name}</Text></Pressable>)}</ScrollView>:null}<Pressable style={[styles.shareAction,{backgroundColor:"#fff0f0"}]} onPress={onSos}><Ionicons name="warning" size={18} color="#c92626"/><Text style={[styles.shareActionText,{color:"#c92626"}]}>Seguridad Flash · SOS</Text></Pressable><Pressable style={styles.reportIssueButton} onPress={onCancel}><Ionicons name="close-circle-outline" size={18} color="#8f3840"/><Text style={styles.reportIssueText}>Cancelar viaje</Text><Ionicons name="chevron-forward" size={17} color="#a29aa5"/></Pressable></ScrollView></View></View></Modal>;
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
    return <LoginScreen busy={busy} onLogin={login} onRegister={register} />;

  return (
    <SafeAreaView
      style={[styles.root, mode === "customer" && styles.customerRoot]}
    >
      <MobileNetworkStatus online={networkOnline} />
      {mode !== "customer" && (
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Flash native</Text>
            <Text style={styles.title}>Food, taxi and driver ops</Text>
          </View>
          <Pressable onPress={logout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Salir</Text>
          </Pressable>
        </View>
      )}

      {mode !== "customer" && (
        <View style={styles.sessionBar}>
          <Text style={styles.sessionRole}>
            {mode === "merchant" ? "Comercio" : "Conductor"}
          </Text>
          <Text style={styles.sessionName}>{sessionUser?.name}</Text>
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
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} />
          }
        >
          {mode === "merchant" && activeRestaurant && (
            <MerchantScreen
              restaurant={activeRestaurant}
              orders={state.orders}
              busy={busy}
              runAction={runAction}
            />
          )}
          {mode === "driver" && activeDriver && (
            <DriverScreen
              state={state}
              driver={activeDriver}
              busy={busy}
              runAction={runAction}
            />
          )}
        </ScrollView>
      )}
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
}: {
  state: AppState;
  user: User;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  refresh: () => Promise<void>;
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
  const [foodOfferVisible, setFoodOfferVisible] = useState(true);
  useEffect(() => {
    customerScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [foodScreen, customerWindow, sharedView]);
  const [foodQuery, setFoodQuery] = useState("");
  type CatalogSearchResult={restaurantId:string;restaurantName:string;cuisine:string;image:string;cover:string;etaMin:number;deliveryFee:number;matchedItems:Array<{id:string;name:string;category:string}>;matchCount:number;score:number};
  const[catalogResults,setCatalogResults]=useState<CatalogSearchResult[]>([]),[catalogSearchLoading,setCatalogSearchLoading]=useState(false),[catalogSearchError,setCatalogSearchError]=useState(""),[catalogNextOffset,setCatalogNextOffset]=useState<number|null>(null);
  const [foodCategory, setFoodCategory] = useState("Todos");
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
  const [cart, setCart] = useState<MobileCartLine[]>([]);
  const[lastCreatedOrder,setLastCreatedOrder]=useState<Order|null>(null);
  const [cartHydrated,setCartHydrated]=useState(false);
  const [customizingItem,setCustomizingItem]=useState<Restaurant["menu"][number]|null>(null);
  const [customizingRestaurant,setCustomizingRestaurant]=useState<Restaurant|null>(null);
  const [customizingExtras,setCustomizingExtras]=useState<string[]>([]);
  const [customizingNote,setCustomizingNote]=useState("");
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
  useEffect(()=>{if(foodScreen!=="search")return;let cancelled=false;setCatalogSearchLoading(true);setCatalogSearchError("");const timer=setTimeout(()=>{void api.searchCatalog(foodQuery,0).then(result=>{if(!cancelled){setCatalogResults(result.results);setCatalogNextOffset(result.nextOffset);}}).catch(error=>{if(!cancelled){setCatalogResults([]);setCatalogSearchError(error instanceof Error?error.message:"No se pudo buscar");}}).finally(()=>{if(!cancelled)setCatalogSearchLoading(false);});},250);return()=>{cancelled=true;clearTimeout(timer);};},[foodScreen,foodQuery,dietaryPreferences.hideIncompatible,dietaryPreferences.dietaryLabels,dietaryPreferences.avoidedAllergens]);
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
                  <View>
                    <Text style={styles.foodDeliverLabel}>DELIVER TO</Text>
                    <Text style={styles.foodAddress} numberOfLines={1}>
                      {deliveryAddress || "Elegí tu ubicación"}⌄
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setFoodScreen("cart")}
                    style={styles.foodCartIcon}
                  >
                    <Ionicons name="bag-handle" size={19} color="#fff" />
                    {cart.length > 0 && (
                      <Text style={styles.foodCartCount}>
                        {cart.reduce((sum, line) => sum + line.quantity, 0)}
                      </Text>
                    )}
                  </Pressable>
                </View>
                <Text style={styles.foodGreeting}>
                  Hola, {user.name.split(" ")[0]}.{" "}
                  <Text style={styles.foodGreetingStrong}>¡Buen día!</Text>
                </Text>
                <Pressable
                  onPress={() => setFoodScreen("search")}
                  style={styles.foodSearchButton}
                >
                  <Ionicons name="search" size={18} color="#9a979d" />
                  <Text style={styles.foodSearchPlaceholder}>
                    Buscar platos o restaurantes
                  </Text>
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
                  {[
                    [
                      "Todos",
                      "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=240",
                    ],
                    [
                      "Parrilla",
                      "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=240",
                    ],
                    [
                      "Sushi",
                      "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=240",
                    ],
                    [
                      "Pizza",
                      "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=240",
                    ],
                    [
                      "Plant",
                      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=240",
                    ],
                  ].map(([category, image]) => (
                    <Pressable
                      key={category}
                      onPress={() => setFoodCategory(category)}
                      style={styles.foodCategoryItem}
                    >
                      <View
                        style={[
                          styles.foodCategoryArt,
                          foodCategory === category &&
                            styles.foodCategoryArtActive,
                        ]}
                      >
                        <Image
                          source={{ uri: image }}
                          style={styles.foodCategoryImage}
                        />
                      </View>
                      <Text style={styles.foodCategoryName}>{category}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>
                    Restaurantes abiertos
                  </Text>
                  <Text style={styles.foodSeeAll}>
                    {openRestaurants.length} cerca ›
                  </Text>
                </View>
                {openRestaurants.map((restaurant) => (
                  <Pressable
                    key={restaurant.id}
                    onPress={() => {
                      setSelectedRestaurantId(restaurant.id);
                      setFoodScreen("restaurant");
                    }}
                    style={styles.foodCard}
                  >
                    <ImageBackground
                      source={{ uri: restaurant.cover }}
                      imageStyle={styles.foodCardBannerImage}
                      style={styles.foodCardBannerLarge}
                    >
                      <View style={styles.foodCardTopline}>
                        <Text style={styles.foodCardPromo}>
                          {restaurant.badge}
                        </Text>
                        <Pressable style={styles.foodHeart}>
                          <Ionicons
                            name="heart-outline"
                            size={18}
                            color="#222"
                          />
                        </Pressable>
                      </View>
                    </ImageBackground>
                    <Text style={styles.cardTitle}>{restaurant.name}</Text>
                    <Text style={styles.cardText}>{restaurant.cuisine}</Text>
                    <View style={styles.foodMetaRow}>
                      <Text style={styles.foodRating}>
                        ☆ {restaurant.rating}
                      </Text>
                      <Text style={styles.cardText}>
                        🛵{" "}
                        {restaurant.deliveryFee
                          ? money.format(restaurant.deliveryFee)
                          : "Gratis"}
                      </Text>
                      <Text style={styles.cardText}>
                        ◷ {restaurant.etaMin} min
                      </Text>
                    </View>
                  </Pressable>
                ))}
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
                  <Text style={styles.foodPageTitle}>Buscar</Text>
                </View>
                <View style={styles.foodSearchButton}>
                  <Ionicons name="search" size={18} color="#9a979d" />
                  <TextInput
                    autoFocus
                    value={foodQuery}
                    onChangeText={setFoodQuery}
                    placeholder="Pizza"
                    style={styles.foodSearchInput}
                  />
                </View>
                <Text style={styles.foodSectionTitle}>
                  {foodQuery ? "Resultados" : "Búsquedas recientes"}
                </Text>
                {!foodQuery && (
                  <View style={styles.choiceRow}>
                    {["Burger", "Sandwich", "Pizza", "Sushi"].map((term) => (
                      <Pressable
                        key={term}
                        onPress={() => setFoodQuery(term)}
                        style={styles.foodChip}
                      >
                        <Text>{term}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {catalogSearchLoading&&<View style={styles.searchStatus}><ActivityIndicator color="#ff6a21"/><Text style={styles.cardText}>Buscando en el catálogo…</Text></View>}
                {Boolean(catalogSearchError)&&<View style={styles.searchStatus}><Ionicons name="cloud-offline-outline" size={21} color="#b7443d"/><Text style={styles.cardText}>{catalogSearchError}</Text></View>}
                {!catalogSearchLoading&&!catalogSearchError&&!catalogResults.length&&foodQuery.trim()&&<View style={styles.searchStatus}><Ionicons name="search-outline" size={23} color="#8d8792"/><Text style={styles.cardText}>No encontramos coincidencias disponibles.</Text></View>}
                {catalogResults.map((result) => (
                  <Pressable
                    key={result.restaurantId}
                    onPress={() => {
                      setSelectedRestaurantId(result.restaurantId);
                      setFoodScreen("restaurant");
                    }}
                    style={styles.foodSearchResult}
                  >
                    <ImageBackground
                      source={{ uri: result.cover }}
                      imageStyle={styles.foodCardBannerImage}
                      style={styles.foodResultImage}
                    />
                    <View style={styles.itemCopy}>
                      <Text style={styles.cardTitle}>{result.restaurantName}</Text>
                      <Text style={styles.cardText}>
                        {result.cuisine} · {result.etaMin} min
                      </Text>
                      <Text style={styles.searchMatchText} numberOfLines={1}>{result.matchedItems.map(item=>item.name).join(" · ")}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#aaa" />
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
                    <Ionicons name="chevron-back" size={22} color="#222" />
                  </Pressable>
                  <Pressable style={styles.foodFloatingButton}>
                    <Ionicons name="heart-outline" size={22} color="#222" />
                  </Pressable>
                </ImageBackground>
                <View style={styles.foodRestaurantInfo}>
                  <Text style={styles.foodRestaurantTitle}>
                    {selectedRestaurant.name}
                  </Text>
                  <Text style={styles.cardText}>
                    {selectedRestaurant.cuisine}
                  </Text>
                  <View style={styles.foodMetaRow}>
                    <Text style={styles.foodRating}>
                      ☆ {selectedRestaurant.rating}
                    </Text>
                    <Text style={styles.cardText}>
                      🛵 {money.format(selectedRestaurant.deliveryFee)}
                    </Text>
                    <Text style={styles.cardText}>
                      ◷ {selectedRestaurant.etaMin} min
                    </Text>
                  </View>
                </View>
                <View style={styles.foodMenuTabs}>
                  <Text style={styles.foodMenuTabActive}>Popular</Text>
                  <Text style={styles.foodMenuTab}>Combos</Text>
                  <Text style={styles.foodMenuTab}>Bebidas</Text>
                </View>
                {dietaryPreferences.hideIncompatible&&<View style={styles.dietaryFilterBanner}><Ionicons name="options-outline" size={17} color="#087a50"/><Text style={styles.dietaryBadgeText}>Filtro personal activo · sólo productos declarados compatibles</Text></View>}
                {selectedRestaurant.menu.filter(item=>!dietaryPreferences.hideIncompatible||itemMatchesDiet(item)).map((item) => (
                  <View key={item.id} style={styles.foodProductCard}>
                    <ImageBackground
                      source={{ uri: selectedRestaurant.cover }}
                      imageStyle={styles.foodProductImageStyle}
                      style={styles.foodProductImage}
                    />
                    <View style={styles.itemCopy}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.cardText} numberOfLines={2}>
                        Preparado al momento con ingredientes seleccionados.
                      </Text>
                      <Text style={styles.foodProductPrice}>
                        {money.format(item.price)}
                      </Text>
                    </View>
                    <Pressable
                      disabled={!item.stock || busy}
                      onPress={() => {if(item.modifierGroups?.length){setCustomizingRestaurant(selectedRestaurant);setCustomizingItem(item);setCustomizingExtras([]);setCustomizingNote("");}else addItem(selectedRestaurant,item);}}
                      style={styles.foodAddButton}
                    >
                      <Ionicons name="add" size={22} color="#fff" />
                    </Pressable>
                  </View>
                ))}
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

            <Modal
              transparent
              visible={foodOfferVisible}
              animationType="fade"
              onRequestClose={() => setFoodOfferVisible(false)}
            >
              <View style={styles.foodModalBackdrop}>
                <LinearGradient
                  colors={["#ffd52f", "#ff720f"]}
                  style={styles.foodOfferModal}
                >
                  <Pressable
                    onPress={() => setFoodOfferVisible(false)}
                    style={styles.foodModalClose}
                  >
                    <Ionicons name="close" size={20} color="#ff6a21" />
                  </Pressable>
                  <Ionicons name="paper-plane" size={44} color="#fff" />
                  <Text style={styles.foodModalTitle}>Hurry Offers!</Text>
                  <Text style={styles.foodModalCode}>#FLASH25</Text>
                  <Text style={styles.foodModalCopy}>
                    Obtené 25% de descuento en restaurantes seleccionados.
                  </Text>
                  <Pressable
                    onPress={() => setFoodOfferVisible(false)}
                    style={styles.foodModalAction}
                  >
                    <Text style={styles.foodModalActionText}>ENTENDIDO</Text>
                  </Pressable>
                </LinearGradient>
              </View>
            </Modal>
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
            <View style={styles.activityHeading}>
              <Text style={styles.foodRestaurantTitle}>Tu cuenta</Text>
              <Text style={styles.cardText}>
                Datos utilizados por todos los servicios Flash.
              </Text>
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
}: {
  restaurant: Restaurant;
  orders: Order[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [chatJobId,setChatJobId]=useState<string|null>(null);
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    category: "Especiales",
    price: "",
  });
  const restaurantOrders = orders.filter(
    (order) => order.restaurantId === restaurant.id,
  );
  const activeOrders = restaurantOrders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const revenue = restaurantOrders.reduce((sum, order) => sum + order.total, 0);
  return (
    <View style={styles.stack}>
      <ServiceChatModal jobId={chatJobId} currentUserId={restaurant.ownerId} onClose={()=>setChatJobId(null)}/>
      <View style={styles.cardDark}>
        <Text style={styles.heroLabel}>
          {restaurant.open ? "Abierto" : "Pausado"}
        </Text>
        <Text style={styles.heroTitle}>{restaurant.name}</Text>
        <Text style={styles.heroCopy}>{restaurant.address}</Text>
      </View>
      <KpiRow
        items={[
          ["Venta", revenue],
          ["Activos", activeOrders.length],
          ["ETA", restaurant.etaMin],
          ["Stock", restaurant.menu.filter((item) => item.stock).length],
        ]}
      />
      <View style={styles.actionRow}>
        <ActionButton
          label={restaurant.open ? "Pausar" : "Abrir"}
          disabled={busy}
          onPress={() =>
            runAction(
              () =>
                api.updateRestaurant(restaurant.id, { open: !restaurant.open }),
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
                  etaMin: restaurant.etaMin + 5,
                }),
              "ETA actualizada",
            )
          }
        />
      </View>
      <Text style={styles.sectionTitle}>Cocina en vivo</Text>
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.stack}><OrderCard
          order={order}
          disabled={busy}
          onPress={() =>
            runAction(() => api.advanceOrder(order.id), "Pedido avanzado")
          }
        /><Pressable style={styles.shareAction} onPress={()=>setChatJobId(order.id)}><Ionicons name="chatbubbles-outline" size={18} color="#7c3cff"/><Text style={styles.shareActionText}>Chat del pedido</Text></Pressable></View>
      ))}
      {activeOrders.length === 0 && (
        <Text style={styles.muted}>No hay pedidos activos para gestionar.</Text>
      )}
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
    </View>
  );
}

function DriverScreen({
  state,
  driver,
  busy,
  runAction,
}: {
  state: AppState;
  driver: Driver;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
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
  const [vehicleDraft,setVehicleDraft]=useState<{kind:DriverVehicle["kind"];model:string;plate:string;color:string;seats:string}>({kind:"car",model:"",plate:"",color:"",seats:"4"});

  const loadCompliance=useCallback(async()=>{try{setCompliance((await api.getDriverCompliance(driver.id)).compliance);}catch(_error){setCompliance(null);}},[driver.id]);
  const loadVehicles=useCallback(async()=>{try{setVehicles((await api.getDriverVehicles(driver.id)).vehicles);}catch(_error){setVehicles([]);}},[driver.id]);
  useEffect(()=>{void loadCompliance();void loadVehicles();},[loadCompliance,loadVehicles]);
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
  const navigationTarget=useMemo(()=>{const ride=activeRides[0];if(ride){const toPickup=ride.status!=="in_progress";return{id:ride.id,kind:"Viaje",phase:toPickup?"Buscar pasajero":"Llevar pasajero",point:toPickup?ride.pickupLocation:ride.destinationLocation,address:toPickup?ride.pickup:ride.destination};}const order=activeOrders[0];if(order){const toPickup=!['picked_up','delivering'].includes(order.status);return{id:order.id,kind:"Comida",phase:toPickup?"Ir al comercio":"Entregar pedido",point:toPickup?order.pickupLocation:order.deliveryLocation,address:toPickup?"Punto de retiro":order.deliveryAddress};}const shipment=activeShipments[0];if(shipment){const toPickup=!['picked_up','delivering'].includes(shipment.status);return{id:shipment.id,kind:"Envío",phase:toPickup?"Retirar paquete":"Entregar paquete",point:toPickup?shipment.pickupLocation:shipment.destinationLocation,address:toPickup?shipment.pickup:shipment.destination};}return null;},[activeRides,activeOrders,activeShipments]);
  const activeVehicle=vehicles.find(vehicle=>vehicle.active&&vehicle.status==="approved")||null;
  const navigationTravelMode=activeVehicle?.kind==="bicycle"?"bicycling":"driving";
  const openExternalNavigation=async()=>{const point=navigationTarget?.point;if(!point)return;const url=buildExternalNavigationUrl(Platform.OS,point,navigationTravelMode);if(!url)return;try{await Linking.openURL(url);}catch(_error){Alert.alert("Navegación no disponible","No pudimos abrir la aplicación de mapas de este dispositivo.");}};

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

  return (
    <View style={styles.stack}>
      <SignatureCaptureModal visible={Boolean(signatureShipmentId)} onClose={()=>{if(!deliveryEvidenceUploading)setSignatureShipmentId(null);}} onSave={saveDeliverySignature} busy={Boolean(deliveryEvidenceUploading)}/>
      <ServiceChatModal jobId={chatJobId} currentUserId={driver.userId} onClose={()=>setChatJobId(null)}/>
      <View style={styles.cardDark}>
        <Text style={styles.heroLabel}>
          {driver.online ? "Online" : "Offline"}
        </Text>
        <Text style={styles.heroTitle}>{driver.name}</Text>
        <Text style={styles.heroCopy}>
          {driver.vehicle} - {driver.plate} - rating {driver.rating}
        </Text>
        <Text style={styles.gpsText}>
          {gpsStatus === "live"
            ? "GPS activo"
            : gpsStatus === "requesting"
              ? "Solicitando GPS"
              : gpsStatus === "denied"
                ? "GPS no disponible"
                : "GPS pausado"}
        </Text>
        <Text style={styles.gpsText}>{backgroundGps==="active"?"Segundo plano activo":backgroundGps==="foreground_only"?"Sólo mientras la app está abierta":backgroundGps==="denied"?"Permiso background rechazado":"Segundo plano detenido"} · sesión {api.sessionStorage==="native-keychain-keystore"?"protegida":"web"}</Text>
      </View>
      <KpiRow
        items={[
          ["Ganancias", driver.earningsToday],
          [
            "Activos",
            activeOrders.length + activeRides.length + activeShipments.length,
          ],
          ["Ofertas", visibleOffers.length],
          ["Modo", driver.activeService === "delivery" ? "Delivery" : "Taxi"],
        ]}
      />
      <View style={styles.complianceCard}><View style={styles.complianceHeader}><View><Text style={styles.heroLabel}>LEGAJO Y SEGURIDAD</Text><Text style={styles.sectionTitle}>Verificación del conductor</Text></View><Text style={[styles.complianceBadge,compliance?.status==="approved"&&styles.complianceBadgeApproved,compliance?.status==="rejected"&&styles.complianceBadgeRejected]}>{(compliance?.status||"cargando").replaceAll("_"," ").toUpperCase()}</Text></View><Text style={styles.cardText}>Los archivos se cifran antes de persistir y sólo operaciones puede aprobarlos.</Text><View style={styles.complianceDocuments}>{compliance?.requiredTypes.map(type=>{const current=compliance.documents.find(document=>document.type===type&&!["superseded"].includes(document.status));const labels={identity:"Identidad",driver_license:"Licencia",vehicle_registration:"Cédula del vehículo",insurance:"Seguro",background_check:"Antecedentes"};return <View style={styles.complianceDocumentRow} key={type}><Ionicons name={current?.status==="approved"?"checkmark-circle":current?.status==="rejected"?"close-circle":"document-text-outline"} size={20} color={current?.status==="approved"?"#087a50":current?.status==="rejected"?"#c43d38":"#7c3cff"}/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{labels[type]}</Text><Text style={styles.cardText}>{current?current.status.replaceAll("_"," "):"Pendiente de envío"}{current?.expiresAt?` · vence ${current.expiresAt}`:""}</Text>{current?.rejectionReason&&<Text style={styles.complianceRejection}>{current.rejectionReason}</Text>}</View></View>})}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{([['identity','Identidad'],['driver_license','Licencia'],['vehicle_registration','Cédula'],['insurance','Seguro'],['background_check','Antecedentes']] as const).map(([value,label])=><Pressable key={value} onPress={()=>setDocumentType(value)} style={[styles.issueCategoryPill,documentType===value&&styles.issueCategoryPillActive]}><Text style={[styles.issueCategoryText,documentType===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView>{["driver_license","vehicle_registration","insurance"].includes(documentType)&&<TextInput style={styles.input} value={documentExpiry} onChangeText={setDocumentExpiry} placeholder="Vencimiento AAAA-MM-DD"/>}<Pressable disabled={documentUploading} style={[styles.primaryButton,documentUploading&&styles.disabledButton]} onPress={pickComplianceDocument}><Ionicons name="cloud-upload-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>{documentUploading?"Cifrando y enviando…":"Elegir PDF o imagen"}</Text></Pressable></View>
      <View style={styles.complianceCard}><View style={styles.complianceHeader}><View><Text style={styles.heroLabel}>FLOTA PERSONAL</Text><Text style={styles.sectionTitle}>Vehículo operativo</Text></View><Text style={styles.complianceBadge}>{vehicles.length}/5</Text></View><Text style={styles.cardText}>Sólo el vehículo activo, aprobado y compatible recibe ofertas. Un cambio vuelve a revisión y te desconecta.</Text>{vehicles.map(vehicle=><View key={vehicle.id} style={styles.complianceDocumentRow}><Ionicons name={vehicle.kind==="bicycle"?"bicycle":vehicle.kind==="motorcycle"?"speedometer-outline":"car-sport-outline"} size={22} color={vehicle.active?"#7c3cff":"#777"}/><View style={styles.itemCopy}><Text style={styles.sectionTitle}>{vehicle.model} · {vehicle.plate}</Text><Text style={styles.cardText}>{vehicle.kind} · {vehicle.serviceModes.join(" + ")} · {vehicle.status}{vehicle.active?" · activo":""}</Text>{vehicle.rejectionReason&&<Text style={styles.complianceRejection}>{vehicle.rejectionReason}</Text>}</View>{!vehicle.active&&vehicle.status==="approved"?<Pressable disabled={vehicleBusy} onPress={()=>void runVehicleAction(()=>api.activateDriverVehicle(vehicle.id),"Vehículo activado; revisá tu disponibilidad.")}><Ionicons name="checkmark-circle-outline" size={25} color="#087a50"/></Pressable>:null}<Pressable disabled={vehicleBusy} onPress={()=>Alert.alert("Retirar vehículo",`¿Retirar ${vehicle.model}? La evidencia histórica se conservará.`,[{text:"Cancelar",style:"cancel"},{text:"Retirar",style:"destructive",onPress:()=>void runVehicleAction(()=>api.retireDriverVehicle(vehicle.id),"Vehículo retirado") }])}><Ionicons name="trash-outline" size={21} color="#a33939"/></Pressable></View>)}<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentBrandRail}>{([['bicycle','Bici'],['motorcycle','Moto'],['car','Auto'],['van','Van']] as const).map(([value,label])=><Pressable key={value} onPress={()=>setVehicleDraft(current=>({...current,kind:value,seats:["car","van"].includes(value)?current.seats||"4":"1"}))} style={[styles.issueCategoryPill,vehicleDraft.kind===value&&styles.issueCategoryPillActive]}><Text style={[styles.issueCategoryText,vehicleDraft.kind===value&&styles.issueCategoryTextActive]}>{label}</Text></Pressable>)}</ScrollView><TextInput style={styles.input} value={vehicleDraft.model} onChangeText={model=>setVehicleDraft(current=>({...current,model}))} placeholder="Marca y modelo"/><TextInput style={styles.input} value={vehicleDraft.plate} onChangeText={plate=>setVehicleDraft(current=>({...current,plate:plate.toUpperCase()}))} autoCapitalize="characters" placeholder="Patente"/><TextInput style={styles.input} value={vehicleDraft.color} onChangeText={color=>setVehicleDraft(current=>({...current,color}))} placeholder="Color"/>{["car","van"].includes(vehicleDraft.kind)?<TextInput style={styles.input} value={vehicleDraft.seats} onChangeText={seats=>setVehicleDraft(current=>({...current,seats:seats.replace(/\D/g,"").slice(0,1)}))} keyboardType="numeric" placeholder="Asientos"/>:null}<Pressable disabled={vehicleBusy||!vehicleDraft.model.trim()||vehicleDraft.plate.trim().length<3} style={[styles.primaryButton,(vehicleBusy||!vehicleDraft.model.trim()||vehicleDraft.plate.trim().length<3)&&styles.disabledButton]} onPress={()=>void addVehicle()}><Ionicons name="add-circle-outline" size={19} color="#fff"/><Text style={styles.primaryButtonText}>{vehicleBusy?"Guardando…":"Registrar vehículo"}</Text></Pressable></View>
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
      <Text style={styles.sectionTitle}>Activos</Text>
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
      ) : null}
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
          <Pressable style={styles.proofCameraButton} onPress={()=>void openExternalNavigation()} accessibilityRole="button" accessibilityLabel="Abrir navegación giro a giro">
            <Ionicons name="navigate" size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>Navegar</Text>
          </Pressable>
        </View>
      )}
      {driverRouteError ? <Text style={styles.complianceRejection}>{driverRouteError}</Text> : null}
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
      <Text style={styles.cardTitle}>{order.status}</Text>
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
  customerScrollContent: { padding: 14, paddingBottom: 24 },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: "#161b22",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
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
    gap: 8,
    padding: 6,
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e8e5eb",
  },
  serviceNavItem: {
    flex: 1,
    minHeight: 64,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  serviceNavItemActive: { backgroundColor: "#17131c" },
  serviceIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#fff0e9",
    alignItems: "center",
    justifyContent: "center",
  },
  serviceIconBubbleActive: { backgroundColor: "#f4511e" },
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
    paddingHorizontal: 2,
  },
  foodDeliverLabel: {
    color: "#ff6a21",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  foodAddress: {
    color: "#252128",
    fontWeight: "800",
    maxWidth: 260,
    marginTop: 2,
  },
  foodCartIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: "#252128",
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
    backgroundColor: "#ff6a21",
    color: "#fff",
    fontSize: 10,
    textAlign: "center",
    paddingTop: 2,
    overflow: "hidden",
  },
  foodGreeting: { color: "#555057", fontSize: 16, marginVertical: 4 },
  foodGreetingStrong: { color: "#252128", fontWeight: "900" },
  foodSearchButton: {
    minHeight: 50,
    borderRadius: 13,
    paddingHorizontal: 14,
    backgroundColor: "#f5f3f4",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  foodSearchPlaceholder: { color: "#9a979d", flex: 1 },
  foodSearchInput: { color: "#252128", flex: 1, minHeight: 46 },
  foodSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 5,
  },
  foodSectionTitle: { color: "#252128", fontSize: 17, fontWeight: "800" },
  foodSeeAll: { color: "#6f6971", fontSize: 12, fontWeight: "700" },
  foodCategoryRail: { gap: 14, paddingVertical: 4 },
  foodCategoryItem: { width: 65, alignItems: "center", gap: 7 },
  foodCategoryArt: {
    width: 58,
    height: 58,
    borderRadius: 21,
    backgroundColor: "#fff3ea",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#f6e5d8",
  },
  foodCategoryArtActive: {
    borderColor: "#ff6a21",
    borderWidth: 3,
    shadowColor: "#ff6a21",
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  foodCategoryImage: { width: 52, height: 52, borderRadius: 18 },
  foodCategoryName: { color: "#474148", fontSize: 11, fontWeight: "700" },
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
    gap: 14,
    marginTop: 3,
  },
  foodRating: { color: "#ff6a21", fontWeight: "900" },
  foodHeart: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  foodPageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 46,
  },
  foodBack: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#f5f3f4",
    alignItems: "center",
    justifyContent: "center",
  },
  foodPageTitle: { color: "#252128", fontSize: 18, fontWeight: "900" },
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
    height: 230,
    borderRadius: 26,
    padding: 15,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  foodRestaurantHeroImage: { borderRadius: 26 },
  foodFloatingButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  foodRestaurantInfo: {
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 17,
    marginTop: -30,
    marginHorizontal: 12,
    gap: 4,
  },
  foodRestaurantTitle: { color: "#252128", fontSize: 22, fontWeight: "900" },
  foodMenuTabs: {
    flexDirection: "row",
    gap: 26,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee9ec",
  },
  foodMenuTab: { color: "#969198", fontWeight: "700" },
  foodMenuTabActive: {
    color: "#ff6a21",
    fontWeight: "900",
    borderBottomWidth: 2,
    borderBottomColor: "#ff6a21",
    paddingBottom: 8,
  },
  foodProductCard: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 10,
  },
  foodProductImage: { width: 92, height: 92, borderRadius: 16 },
  foodProductImageStyle: { borderRadius: 16 },
  foodProductPrice: { color: "#ff6a21", fontWeight: "900", marginTop: 5 },
  foodAddButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: "#ff6a21",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
  },
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
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 20,
  },
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
  substitutionActions:{flexDirection:"row",gap:9},
  substitutionReject:{flex:1,minHeight:43,alignItems:"center",justifyContent:"center",borderRadius:14,borderWidth:1,borderColor:"#ddd6e2",backgroundColor:"#fff"},
  substitutionRejectText:{color:"#554f59",fontSize:12,fontWeight:"900"},
  substitutionAccept:{flex:1.35,minHeight:43,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6,borderRadius:14,backgroundColor:"#ff6a21"},
  substitutionAcceptText:{color:"#fff",fontSize:12,fontWeight:"900"},
  reportIssueButton:{minHeight:46,flexDirection:"row",alignItems:"center",gap:8,paddingHorizontal:12,borderRadius:14,backgroundColor:"#fff4f1",borderWidth:1,borderColor:"#ffd9d1"},
  reportIssueText:{flex:1,color:"#a63e2c",fontSize:12,fontWeight:"900"},
  issueModalBackdrop:{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(24,18,27,.52)"},
  issueModalSheet:{maxHeight:"90%",gap:14,paddingHorizontal:20,paddingTop:10,paddingBottom:28,backgroundColor:"#fff",borderTopLeftRadius:30,borderTopRightRadius:30},
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
  savedAddressRow:{flexDirection:"row",alignItems:"center",gap:11,paddingVertical:12,borderTopWidth:1,borderTopColor:"#f0edf2"},
  savedAddressIcon:{width:42,height:42,borderRadius:14,alignItems:"center",justifyContent:"center",backgroundColor:"#f0eaff"},
  savedAddressIconDefault:{backgroundColor:"#7c3cff"},
  savedAddressCopy:{flex:1,gap:3},
  savedAddressTitle:{flexDirection:"row",alignItems:"center",gap:8},
  defaultAddressBadge:{paddingHorizontal:8,paddingVertical:3,color:"#6d35dc",backgroundColor:"#efe7ff",borderRadius:999,fontSize:10,fontWeight:"900",textTransform:"uppercase"},
  savedAddressActions:{flexDirection:"row",alignItems:"center",gap:13},
  newAddressForm:{gap:11,paddingTop:5},
  paymentMethodRow:{flexDirection:"row",alignItems:"center",gap:11,paddingVertical:12,borderTopWidth:1,borderTopColor:"#f0edf2"},
  paymentBrandRail:{gap:8,paddingVertical:2},
  paymentCompactFields:{flexDirection:"row",gap:10},
  paymentCompactInput:{flex:1},
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
  productCustomizerBackdrop:{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(20,16,24,.48)"},
  productCustomizerSheet:{maxHeight:"88%",padding:18,paddingBottom:28,gap:14,borderTopLeftRadius:28,borderTopRightRadius:28,backgroundColor:"#fff"},
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
  trackingBackdrop:{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(20,15,24,.48)"},
  trackingSheet:{maxHeight:"92%",backgroundColor:"#fff",borderTopLeftRadius:28,borderTopRightRadius:28,padding:18,gap:15},
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
  foodModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(25,31,39,.66)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  foodOfferModal: {
    width: "100%",
    maxWidth: 330,
    minHeight: 320,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    padding: 26,
    gap: 13,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  foodModalClose: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  foodModalTitle: { color: "#fff", fontSize: 34, fontWeight: "900" },
  foodModalCode: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 2,
  },
  foodModalCopy: { color: "#fff", textAlign: "center", lineHeight: 20 },
  foodModalAction: {
    marginTop: 8,
    width: "100%",
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  foodModalActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
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
  foodCardBanner: {
    height: 86,
    borderRadius: 16,
    backgroundColor: "#ffe1cc",
    justifyContent: "flex-start",
    padding: 10,
  },
  foodCardBannerLarge: {
    height: 155,
    borderRadius: 16,
    backgroundColor: "#ffe1cc",
    justifyContent: "flex-start",
    padding: 10,
  },
  foodCardBannerImage: { borderRadius: 16 },
  foodCardTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  foodCardPromo: {
    color: "#fff",
    backgroundColor: "#f4511e",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11,
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
  signatureBackdrop:{flex:1,backgroundColor:"rgba(20,16,24,.48)",justifyContent:"flex-end"},
  signatureSheet:{backgroundColor:"#fff",borderTopLeftRadius:28,borderTopRightRadius:28,padding:20,paddingBottom:32,gap:14},
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
