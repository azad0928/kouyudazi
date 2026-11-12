/// <reference types="@dcloudio/types" />
export {}
declare global {
 const wx: typeof uni & {
   cloud: {init(options:Record<string,unknown>):void;callFunction(options:{name:string;data?:any}):Promise<any>;uploadFile(options:any):any;getTempFileURL(options:any):Promise<any>}
   env: {USER_DATA_PATH:string}
   requestVirtualPayment?: (options:any)=>void
 }
}
