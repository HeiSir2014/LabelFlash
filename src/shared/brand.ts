/** 品牌与产品标识：CDL = 陈大露。所有对外显示的名字都从这里取。 */
export const BRAND = {
  mark: 'CDL',
  /** 出品方全称，显示在「关于」里（标题栏不显示）。 */
  owner: '陈大露工作室',
  productName: 'CDL-云签速印',
  productNameAscii: 'CDL-LabelFlash',
  appId: 'com.cdl.labelflash',
  /**
   * 出品方的淘宝店铺：显示在标题栏和「关于」里；电脑上点击打开，「关于」里的二维码给手机淘宝扫码进店。
   * 用店铺编号地址而不是分享短链：分享短链带分享 token 和签名，可能过期，而二维码会随安装包长期存在。
   */
  shop: {
    name: 'CDLCOUTURE极简女装',
    url: 'https://shop476061869.taobao.com',
  },
} as const;
