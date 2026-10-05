self.addEventListener("push",function(event){
  var data={};
  try{data=event.data?event.data.json():{}}catch(e){data={body:"Nova mensagem"}}
  event.waitUntil(self.registration.showNotification(data.title||"LeadsPay Connect",{
    body:data.body||"Você recebeu uma nova mensagem.",
    icon:"/icon.svg",
    tag:data.tag||"leadspay-connect",
    data:{url:data.url||"/?open=chat"}
  }));
});
self.addEventListener("notificationclick",function(event){
  event.notification.close();
  var target=new URL(event.notification.data&&event.notification.data.url?event.notification.data.url:"/?open=chat",self.location.origin).href;
  event.waitUntil(clients.openWindow(target));
});
