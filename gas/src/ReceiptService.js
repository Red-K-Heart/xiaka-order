/**
 * ============================================================
 * 呷喀煙燻滷味
 * ReceiptService.gs
 * ============================================================
 *
 * 80mm 熱感應單據專用資料服務
 *
 * 注意：
 * Code.gs 已經有正式的：
 *
 *     getOrderDetailsForReceipt(orderId)
 *
 * 因此本檔案「不再建立同名函式」，
 * 避免 GAS 多個 .gs 檔案出現同名函式互相覆蓋。
 *
 * 本檔案提供：
 *
 *     getReceiptData_(orderId)
 *
 * 供後續 Code.gs 或其他收據相關功能使用。
 *
 * ============================================================
 */


/**
 * ============================================================
 * 1. 取得收據資料
 * ============================================================
 *
 * 回傳資料結構：
 *
 * {
 *   Order_ID,
 *   Customer_Name,
 *   Customer_Phone,
 *   Pickup_Date,
 *   Pickup_Time_Slot,
 *   Overall_Pepper,
 *   Overall_Chili_Powder,
 *   Overall_Chili_Sauce,
 *   Veg_Separate,
 *   Total_Amount,
 *   Discount_Amount,
 *   Order_Time,
 *   Timestamp,
 *   Remarks,
 *   items
 * }
 *
 * items：
 *
 * [
 *   {
 *     Product_ID,
 *     Item_Name,
 *     Quantity,
 *     Unit_Price,
 *     Subtotal,
 *     Is_Gift
 *   }
 * ]
 *
 * ============================================================
 */
function getReceiptData_(orderId) {

  var ss =
    SpreadsheetApp.getActiveSpreadsheet();

  var targetOrderId =
    String(orderId || "").trim();


  Logger.log(
    "=================================================="
  );

  Logger.log(
    "【getReceiptData_】開始執行，查詢編號: [" +
    targetOrderId +
    "]"
  );

  Logger.log(
    "=================================================="
  );


  /**
   * ----------------------------------------------------------
   * 1-1. 檢查訂單編號
   * ----------------------------------------------------------
   */
  if (!targetOrderId) {

    Logger.log(
      "❌ targetOrderId 為空，無法查詢。"
    );

    return null;
  }


  /**
   * ----------------------------------------------------------
   * 1-2. Orders
   * ----------------------------------------------------------
   */
  var ordersSheet =
    ss.getSheetByName("Orders");


  if (!ordersSheet) {

    Logger.log(
      "❌ 找不到 Orders 工作表。"
    );

    return null;
  }


  var ordersData =
    ordersSheet
      .getDataRange()
      .getValues();


  if (ordersData.length <= 1) {

    Logger.log(
      "⚠️ Orders 沒有訂單資料。"
    );

    return null;
  }


  /**
   * 取得 Orders 欄位名稱
   */
  var ordersHeaders =
    getReceiptHeaders_(
      ordersSheet
    );


  /**
   * ----------------------------------------------------------
   * 1-3. 尋找指定訂單
   * ----------------------------------------------------------
   */
  var orderData = null;


  for (
    var i = 1;
    i < ordersData.length;
    i++
  ) {

    var row =
      ordersData[i];


    /**
     * ★ 依欄位名稱取得 Order_ID
     *
     * 不使用 row[0]
     */
    var sheetOrderId =
      String(
        getReceiptValue_(
          row,
          ordersHeaders,
          [
            "Order_ID",
            "訂單編號"
          ],
          ""
        )
      ).trim();


    if (
      sheetOrderId !==
      targetOrderId
    ) {

      continue;
    }


    /**
     * --------------------------------------------------------
     * 找到訂單
     * --------------------------------------------------------
     */

    var customerName =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Customer_Name",
          "客戶姓名"
        ],
        ""
      );


    var customerPhone =
      String(
        getReceiptValue_(
          row,
          ordersHeaders,
          [
            "Customer_Phone",
            "客戶電話"
          ],
          ""
        )
      )
      .replace(/^'/, "");


    var pickupDate =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Pickup_Date",
          "預約取餐日期"
        ],
        ""
      );


    var pickupTimeSlot =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Pickup_Time_Slot",
          "預計取餐時段"
        ],
        ""
      );


    var overallPepper =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Overall_Pepper",
          "Pepper",
          "整單胡椒鹽(不加/小/中/大)"
        ],
        "正常"
      ) || "正常";


    var overallChiliPowder =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Overall_Chili_Powder",
          "Chili_Powder",
          "整單辣椒粉(不加/小/中/大)"
        ],
        "不加"
      ) || "不加";


    var overallChiliSauce =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Overall_Chili_Sauce",
          "Chili_Sauce",
          "整單辣醬(要/不加)"
        ],
        "不加"
      ) || "不加";


    var vegSeparate =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Veg_Separate",
          "蔬菜分裝選項"
        ],
        "否"
      ) || "否";


    var totalAmount =
      Number(
        getReceiptValue_(
          row,
          ordersHeaders,
          [
            "Total_Amount",
            "實際結帳金額NT$"
          ],
          0
        )
      ) || 0;


    var discountAmount =
      Number(
        getReceiptValue_(
          row,
          ordersHeaders,
          [
            "Discount_Amount",
            "折扣金額NT$"
          ],
          0
        )
      ) || 0;


    var orderTime =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Order_Time",
          "Timestamp",
          "下單時間"
        ],
        ""
      );


    var remarks =
      getReceiptValue_(
        row,
        ordersHeaders,
        [
          "Remarks",
          "訂單備註(含優惠說明)"
        ],
        ""
      );


    /**
     * --------------------------------------------------------
     * 建立收據訂單資料
     *
     * 同時保留大小寫欄位，
     * 確保 PrintReceipt.html 相容。
     * --------------------------------------------------------
     */
    orderData = {

      /* 大寫 */
      Order_ID:
        sheetOrderId,

      Customer_Name:
        customerName,

      Customer_Phone:
        customerPhone,

      Pickup_Date:
        pickupDate,

      Pickup_Time_Slot:
        pickupTimeSlot,

      Overall_Pepper:
        overallPepper,

      Overall_Chili_Powder:
        overallChiliPowder,

      Overall_Chili_Sauce:
        overallChiliSauce,

      Veg_Separate:
        vegSeparate,

      Total_Amount:
        totalAmount,

      Discount_Amount:
        discountAmount,

      Order_Time:
        orderTime,

      Timestamp:
        orderTime,

      Remarks:
        remarks,


      /* 小寫相容 */
      order_id:
        sheetOrderId,

      customer_name:
        customerName,

      customer_phone:
        customerPhone,

      pickup_date:
        pickupDate,

      pickup_time_slot:
        pickupTimeSlot,

      pepper:
        overallPepper,

      chili_powder:
        overallChiliPowder,

      chili_sauce:
        overallChiliSauce,

      veg_separate:
        vegSeparate,

      total_amount:
        totalAmount,

      discount_amount:
        discountAmount,

      timestamp:
        orderTime,

      remarks:
        remarks
    };


    break;
  }


  /**
   * 沒找到訂單
   */
  if (!orderData) {

    Logger.log(
      "⚠️ 找不到訂單：" +
      targetOrderId
    );

    return null;
  }


  /**
   * ========================================================
   * 2. 讀取 OrderItems
   * ========================================================
   */
  var itemsSheet =
    ss.getSheetByName("OrderItems");


  var items = [];


  if (itemsSheet) {

    var itemsData =
      itemsSheet
        .getDataRange()
        .getValues();


    if (itemsData.length > 1) {

      var itemsHeaders =
        getReceiptHeaders_(
          itemsSheet
        );


      /**
       * ------------------------------------------------------
       * 逐筆讀取 OrderItems
       * ------------------------------------------------------
       */
      for (
        var j = 1;
        j < itemsData.length;
        j++
      ) {

        var itemRow =
          itemsData[j];


        /**
         * ★ 只透過 Order_ID 欄位判斷
         *
         * 不再搜尋整列所有欄位。
         */
        var itemOrderId =
          String(
            getReceiptValue_(
              itemRow,
              itemsHeaders,
              [
                "Order_ID",
                "訂單編號"
              ],
              ""
            )
          ).trim();


        if (
          itemOrderId !==
          targetOrderId
        ) {

          continue;
        }


        /**
         * 商品編號
         */
        var productId =
          getReceiptValue_(
            itemRow,
            itemsHeaders,
            [
              "Product_ID",
              "商品編號"
            ],
            ""
          );


        /**
         * 商品名稱
         */
        var itemName =
          getReceiptValue_(
            itemRow,
            itemsHeaders,
            [
              "Item_Name",
              "品項名稱"
            ],
            ""
          );


        /**
         * 數量
         */
        var quantity =
          Number(
            getReceiptValue_(
              itemRow,
              itemsHeaders,
              [
                "Quantity",
                "購買數量"
              ],
              0
            )
          ) || 0;


        /**
         * 單價
         */
        var unitPrice =
          Number(
            getReceiptValue_(
              itemRow,
              itemsHeaders,
              [
                "Unit_Price",
                "結帳單價"
              ],
              0
            )
          ) || 0;


        /**
         * 小計
         */
        var subtotal =
          Number(
            getReceiptValue_(
              itemRow,
              itemsHeaders,
              [
                "Subtotal",
                "小計公式"
              ],
              0
            )
          );


        /**
         * 如果 Sheet 沒有小計，
         * 自動用數量 × 單價
         */
        if (!subtotal) {

          subtotal =
            quantity *
            unitPrice;
        }


        /**
         * ----------------------------------------------------
         * Is_Gift
         *
         * 現在 Code.gs 寫入的是：
         *
         * TRUE / FALSE
         *
         * 這裡同時相容：
         *
         * TRUE
         * FALSE
         * "TRUE"
         * "FALSE"
         * "是"
         * "否"
         * 1
         * 0
         *
         * 最後統一轉成真正 Boolean。
         * ----------------------------------------------------
         */
        var rawIsGift =
          getReceiptValue_(
            itemRow,
            itemsHeaders,
            [
              "Is_Gift",
              "是否為贈品(TRUE/FALSE)"
            ],
            false
          );


        var isGift =
          normalizeReceiptBoolean_(
            rawIsGift
          );


        /**
         * 建立商品明細
         */
        items.push({

          /* 大寫 */
          Product_ID:
            productId,

          Item_Name:
            itemName,

          Quantity:
            quantity,

          Unit_Price:
            unitPrice,

          Subtotal:
            subtotal,

          Is_Gift:
            isGift,


          /* 小寫 */
          product_id:
            productId,

          item_name:
            itemName,

          quantity:
            quantity,

          unit_price:
            unitPrice,

          subtotal:
            subtotal,

          is_gift:
            isGift
        });
      }
    }
  }


  /**
   * ========================================================
   * 3. 將明細放入訂單資料
   * ========================================================
   */
  orderData.items =
    items;


  /**
   * ========================================================
   * 4. 依 Products / Product_ID 分類
   *
   * normalItems
   * vegItems
   * ========================================================
   */
  var classified =
    classifyReceiptItems_(
      ss,
      items
    );


  orderData.normalItems =
    classified.normalItems;


  orderData.vegItems =
    classified.vegItems;


  /**
   * ========================================================
   * 5. 回傳乾淨 JSON
   * ========================================================
   */
  return JSON.parse(
    JSON.stringify(
      orderData
    )
  );
}


/**
 * ============================================================
 * 2. 依 Product_ID / Products Category 分類商品
 * ============================================================
 *
 * 蔬菜判斷：
 *
 * 1. Product_ID 以 V 開頭
 * 2. Products.Category 包含「蔬菜」
 * 3. Products.Category 包含「青菜」
 * 4. 商品名稱包含「蔬菜」
 * 5. 商品名稱包含「青菜」
 *
 * ============================================================
 */
function classifyReceiptItems_(
  ss,
  items
) {

  var vegProductIdSet = {};


  /**
   * ----------------------------------------------------------
   * 讀取 Products
   * ----------------------------------------------------------
   */
  var productsSheet =
    ss.getSheetByName("Products") ||
    ss.getSheetByName("products");


  if (productsSheet) {

    var productsData =
      productsSheet
        .getDataRange()
        .getValues();


    if (productsData.length > 1) {

      var productsHeaders =
        getReceiptHeaders_(
          productsSheet
        );


      for (
        var i = 1;
        i < productsData.length;
        i++
      ) {

        var row =
          productsData[i];


        var productId =
          String(
            getReceiptValue_(
              row,
              productsHeaders,
              [
                "Product_ID",
                "商品編號"
              ],
              ""
            )
          ).trim();


        var category =
          String(
            getReceiptValue_(
              row,
              productsHeaders,
              [
                "Category",
                "分類"
              ],
              ""
            )
          ).trim();


        var itemName =
          String(
            getReceiptValue_(
              row,
              productsHeaders,
              [
                "Item_Name",
                "品項名稱"
              ],
              ""
            )
          ).trim();


        /**
         * 排除 Products 欄位說明列
         */
        if (
          productId === "商品編號" ||
          productId === "Product_ID"
        ) {

          continue;
        }


        if (!productId) {
          continue;
        }


        /**
         * V 開頭是 CATALOG_RULES
         * 定義的蔬菜 / 青菜類
         */
        if (
          productId
            .toUpperCase()
            .indexOf("V") === 0
        ) {

          vegProductIdSet[
            productId.toUpperCase()
          ] = true;

          continue;
        }


        /**
         * Category 判斷
         */
        if (
          category.indexOf("蔬菜") !== -1 ||
          category.indexOf("青菜") !== -1
        ) {

          vegProductIdSet[
            productId.toUpperCase()
          ] = true;

          continue;
        }


        /**
         * 商品名稱判斷
         */
        if (
          itemName.indexOf("蔬菜") !== -1 ||
          itemName.indexOf("青菜") !== -1
        ) {

          vegProductIdSet[
            productId.toUpperCase()
          ] = true;
        }
      }
    }
  }


  /**
   * ----------------------------------------------------------
   * 分類
   * ----------------------------------------------------------
   */
  var normalItems = [];
  var vegItems = [];


  for (
    var j = 0;
    j < items.length;
    j++
  ) {

    var item =
      items[j];


    var productId =
      String(
        item.Product_ID || ""
      ).trim();


    var itemName =
      String(
        item.Item_Name || ""
      ).trim();


    var pidUpper =
      productId.toUpperCase();


    var isVegetable =
      !!vegProductIdSet[pidUpper] ||
      pidUpper.indexOf("V") === 0 ||
      itemName.indexOf("蔬菜") !== -1 ||
      itemName.indexOf("青菜") !== -1;


    if (isVegetable) {

      vegItems.push(item);

    } else {

      normalItems.push(item);
    }
  }


  return {

    normalItems:
      normalItems,

    vegItems:
      vegItems
  };
}


/**
 * ============================================================
 * 3. 取得 Sheet 第一列欄位名稱
 * ============================================================
 */
function getReceiptHeaders_(sheet) {

  var lastColumn =
    sheet.getLastColumn();


  if (lastColumn < 1) {

    return [];
  }


  return sheet
    .getRange(
      1,
      1,
      1,
      lastColumn
    )
    .getValues()[0];
}


/**
 * ============================================================
 * 4. 依欄位名稱取得資料
 * ============================================================
 *
 * keyNames 可以傳入多個欄位名稱作為相容名稱。
 *
 * 例如：
 *
 * [
 *   "Order_ID",
 *   "訂單編號"
 * ]
 *
 * ============================================================
 */
function getReceiptValue_(
  row,
  headers,
  keyNames,
  defaultValue
) {

  for (
    var i = 0;
    i < keyNames.length;
    i++
  ) {

    var targetKey =
      normalizeReceiptHeader_(
        keyNames[i]
      );


    for (
      var j = 0;
      j < headers.length;
      j++
    ) {

      var currentKey =
        normalizeReceiptHeader_(
          headers[j]
        );


      if (
        currentKey ===
        targetKey
      ) {

        if (
          row[j] !== undefined &&
          row[j] !== null
        ) {

          return row[j];
        }
      }
    }
  }


  return defaultValue;
}


/**
 * ============================================================
 * 5. 標準化欄位名稱
 * ============================================================
 */
function normalizeReceiptHeader_(
  value
) {

  return String(
    value === undefined ||
    value === null
      ? ""
      : value
  )

    .replace(/[\r\n\t]/g, "")

    .replace(/^\uFEFF/, "")

    .trim()

    .toLowerCase();
}


/**
 * ============================================================
 * 6. Boolean 轉換
 * ============================================================
 *
 * TRUE / true / "TRUE" / "true"
 * → true
 *
 * FALSE / false / "FALSE" / "false"
 * → false
 *
 * 是 → true
 * 否 → false
 *
 * 1 → true
 * 0 → false
 *
 * ============================================================
 */
function normalizeReceiptBoolean_(
  value
) {

  if (value === true) {
    return true;
  }


  if (value === false) {
    return false;
  }


  if (
    typeof value === "number"
  ) {

    return value === 1;
  }


  var str =
    String(
      value === undefined ||
      value === null
        ? ""
        : value
    )
    .trim()
    .toLowerCase();


  if (
    str === "true" ||
    str === "1" ||
    str === "yes" ||
    str === "y" ||
    str === "是"
  ) {

    return true;
  }


  return false;
}