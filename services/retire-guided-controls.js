// Only retire the previous prompt owned by an active guided staff session.
// Never apply this to permanent listings, public giveaway buttons, or staff
// record/directory messages.
export async function retireGuidedControls(previous,channel){
 if(!previous?.id)return false;
 let message=previous;
 if(typeof message.edit!=="function"){
   if(!channel?.messages?.fetch)return false;
   try{message=await channel.messages.fetch(previous.id);}
   catch(error){
     console.warn("[Setup] Could not fetch prior guided prompt:",previous.id,error);
     return false;
   }
 }
 if(!message?.edit)return false;
 try{
   await message.edit({components:[]});
   return true;
 }catch(error){
   console.warn("[Setup] Could not retire prior guided prompt:",previous.id,error);
   return false;
 }
}
