/** 品牌与产品标识：CDL = 陈大露。所有对外显示的名字都从这里取。 */
export const BRAND = {
  mark: 'CDL',
  /** 出品方全称，显示在「关于」里（标题栏不显示）。 */
  owner: '陈大露工作室',
  productName: 'CDL-云签速印',
  productNameAscii: 'CDL-LabelFlash',
  appId: 'com.cdl.labelflash',
  /** 出品方的淘宝店铺：显示在标题栏和「关于」里。 */
  shop: {
    name: 'CDLCOUTURE极简女装',
    /** 电脑上点击打开的店铺首页（短链在电脑上只是一个中转页，直接用店铺地址）。 */
    url: 'https://shop476061869.taobao.com',
    /** 「关于」里的二维码内容：手机淘宝扫码进店。 */
    mobileUrl: 'https://m.tb.cn/h.8wFoJTZnJAhPpdP',
  },
} as const;
