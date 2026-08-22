import { Bell, Check, Settings } from "lucide-react";
import { api } from "./api";
import type { AppState } from "./types";

export default function NotificationCenter({state,runAction,busy}:{state:AppState;runAction:(action:()=>Promise<unknown>,success:string)=>void;busy:boolean}) {
  const notificationTitle:Record<string,string>={order_status:"Actualización del pedido",ride_status:"Actualización del viaje",shipment_status:"Actualización del envío",support_reply:"Nueva respuesta de soporte",support_ticket_created:"Caso de soporte creado",promotion_available:"Nueva promoción disponible"};
  const categoryLabel:Record<string,string>={service_updates:"Servicios",promotions:"Promociones",support:"Soporte",wallet:"Wallet",account:"Cuenta"};
  const unread=state.notifications.filter(notification=>!notification.readAt).length;
  return <div className="activity-stack">
    <section className="address-book-card notification-center-header"><div className="address-book-heading"><div><span className="muted-label">Centro de actividad</span><h2>Notificaciones</h2><p>{unread?`${unread} sin leer`:"Estás al día"}. Las actualizaciones transaccionales permanecen disponibles.</p></div><Bell size={22} aria-hidden="true"/></div></section>
    <section className="address-book-card"><div className="notification-list">
      {state.notifications.map(notification=>{const status=typeof notification.payload.status==="string"?notification.payload.status:"Revisá la actividad de tu cuenta";return <button className={notification.readAt?"notification-row":"notification-row unread"} disabled={busy||Boolean(notification.readAt)} key={notification.id} onClick={()=>runAction(()=>api.markNotificationRead(notification.id),"Notificación marcada como leída")} type="button"><span className="notification-dot" aria-hidden="true"/><span className="notification-copy"><strong>{notificationTitle[notification.template]||"Novedad de Flash"}</strong><span>{status.replaceAll("_"," ")}</span><small>{new Date(notification.createdAt).toLocaleString("es-AR")}{notification.channel==="in_app"?" · Dentro de la app":` · ${notification.channel}`}</small></span>{!notification.readAt&&<span className="notification-new">NUEVA</span>}</button>;})}
      {!state.notifications.length&&<div className="notification-empty"><Check size={18}/><span>Las novedades reales de pedidos, viajes, envíos y soporte aparecerán acá.</span></div>}
    </div></section>
    <section className="address-book-card"><div className="address-book-heading"><div><h3>Preferencias de contacto</h3><p>Push y email se guardan por categoría. Los proveedores externos se habilitan cuando la cuenta productiva esté configurada.</p></div><Settings size={20} aria-hidden="true"/></div><div className="notification-preferences">
      {state.notificationPreferences.map(preference=><div className="notification-preference" key={preference.category}><div><strong>{categoryLabel[preference.category]||preference.category}</strong><span>{preference.pushEnabled?"Push habilitado":"Sólo dentro de la app"}{preference.emailEnabled?" · Email habilitado":""}</span></div><button aria-checked={preference.pushEnabled} className={preference.pushEnabled?"preference-toggle active":"preference-toggle"} disabled={busy} onClick={()=>runAction(()=>api.updateNotificationPreference(preference.category,{pushEnabled:!preference.pushEnabled,emailEnabled:preference.emailEnabled}),"Preferencia actualizada")} role="switch" type="button"><span/></button></div>)}
    </div></section>
  </div>;
}
