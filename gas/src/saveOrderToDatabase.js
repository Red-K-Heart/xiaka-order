
/**
 * ============================================================
 * 1. 網頁應用程式進入點
 * ============================================================
 */
function doGet(e) {
  // ============================================================
  // GitHub Pages API：提供前端讀取 Google Sheets 資料
  // ============================================================
  if (e && e.parameter && e.parameter.api) {

    var apiName = e.parameter.api;
    var callback = e.parameter.callback || "";

    // JSONP callback 名稱安全檢查
    if (!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
      return ContentService
        .createTextOutput("Invalid callback")
        .setMimeType(ContentService.MimeType.TEXT);
    }

    var result;

    try {

      if (apiName === "products") {
        result = getProductsForFrontend();

      } else if (apiName === "operatorPoll") {
        result = operatorGetCachedResponse_(e.parameter);

      } else if (apiName === "catalogRules") {
        result = getCatalogRules();

      } else if (apiName === "storeSettings") {
        result = getStoreSettings();

      } else if (apiName === "submitOrder") {

        var orderData =
          e.parameter.data
            ? JSON.parse(e.parameter.data)
            : null;

        if (!orderData) {
          result = {
            status: "error",
            message: "沒有收到訂單資料。"
          };
        } else {
          result = submitOrderData(orderData);
        }

      } else if (apiName === "orderStatus") {

        var orderId =
          e.parameter.orderId || "";

        var phone =
          e.parameter.phone || "";

        result =
          getOrderStatus(
            orderId,
            phone
          );

      } else {
        result = {
          success: false,
          message: "未知的 API: " + apiName
        };
      }

      return ContentService
        .createTextOutput(
          callback + "(" + JSON.stringify(result) + ");"
        )
        .setMimeType(ContentService.MimeType.JAVASCRIPT);

    } catch (error) {

      var errorResult = {
        success: false,
        message: error.message
      };

      return ContentService
        .createTextOutput(
          callback + "(" + JSON.stringify(errorResult) + ");"
        )
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
  }

  var page = (e && e.parameter && e.parameter.page)
    ? e.parameter.page
    : '';

  /**
   * 80mm 收據列印頁
   */
  if (page === 'print') {

    var template = HtmlService.createTemplateFromFile('PrintReceipt');

    var orderId = (e && e.parameter && e.parameter.order_id)
      ? e.parameter.order_id
      : '';

    var receiptData = null;

    try {

      if (typeof getOrderDetailsForReceipt === 'function') {
        receiptData = getOrderDetailsForReceipt(orderId);
      }

    } catch (err) {

      Logger.log(
        "⚠️ 呼叫 getOrderDetailsForReceipt 失敗: " +
        err.toString()
      );

    }

    if (receiptData) {

      template.order = receiptData;
      template.items = receiptData.items || [];
      template.normalItems = receiptData.normalItems || [];
      template.vegItems = receiptData.vegItems || [];

    } else {

      template.order = {
        Order_ID: orderId || '無效編號',
        order_id: orderId || '無效編號',
        Customer_Name: "查無資料",
        customer_name: "查無資料"
      };

      template.items = [];
      template.normalItems = [];
      template.vegItems = [];
    }

    return template
      .evaluate()
      .setTitle(
        '80mm 列印收據 - ' +
        (orderId || '列印')
      )
      .setXFrameOptionsMode(
        HtmlService.XFrameOptionsMode.ALLOWALL
      );
  }

  /**
   * 一般顧客點餐頁
   */
  return HtmlService
    .createHtmlOutputFromFile('index')
    .setTitle('呷喀煙燻滷味 - 線上點餐')
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
}


/**
 * ============================================================
 * 2. index.html 專用
 *
 * index.html 呼叫：
 *
 * google.script.run.submitOrderData(payload)
 *
 * ============================================================
 */
function submitOrderData(data) {

  return saveOrderData_(data);
}


/**
 * ============================================================
 * 3. 舊版函式相容
 *
 * 如果其他程式仍呼叫：
 *
 * submitOrderToSheet(data)
 *
 * 仍然可以正常運作。
 *
 * 實際寫入仍統一交給 saveOrderData_()
 * ============================================================
 */
function submitOrderToSheet(data) {

  return saveOrderData_(data);
}


/**
 * ============================================================
 * 4. 統一訂單寫入核心
 * ============================================================
 */
function saveOrderData_(data) {

  var lock = LockService.getScriptLock();

  try {

    /**
     * 避免同時間多筆訂單同時寫入造成資料衝突
     */
    lock.waitLock(10000);

    data = data || {};

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    /**
     * --------------------------------------------------------
     * 4-1. 建立訂單編號
     * --------------------------------------------------------
     */
    var now = new Date();

    var orderId =
      "ORD" +
      Utilities.formatDate(
        now,
        "Asia/Taipei",
        "yyyyMMddHHmmss"
      );

    var timestamp =
      Utilities.formatDate(
        now,
        "Asia/Taipei",
        "yyyy-MM-dd HH:mm:ss"
      );

    var todayStr =
      Utilities.formatDate(
        now,
        "Asia/Taipei",
        "yyyy-MM-dd"
      );


    /**
     * --------------------------------------------------------
     * 4-2. 讀取前端資料
     *
     * 支援 index.html 目前使用的 camelCase
     * 同時支援資料庫原本使用的欄位名稱。
     * --------------------------------------------------------
     */

    var lineUid = getInputValue_(
      data,
      [
        "lineUserId",
        "Line_UID",
        "LINE_UID",
        "line_uid"
      ],
      ""
    );

    var customerName = getInputValue_(
      data,
      [
        "customerName",
        "Customer_Name",
        "customer_name"
      ],
      ""
    );

    var rawPhone = getInputValue_(
      data,
      [
        "customerPhone",
        "Customer_Phone",
        "customer_phone"
      ],
      ""
    );

    /**
     * 清理電話
     */
    var phone = String(rawPhone || "")
      .trim()
      .replace(/^'/, "")
      .replace(/[\s-]/g, "");

    /**
     * Google Sheet 強制文字格式
     * 保留電話前面的 0
     */
    var formattedPhone = phone
      ? "'" + phone
      : "";


    var pickupDate = getInputValue_(
      data,
      [
        "pickupDate",
        "Pickup_Date",
        "pickup_date"
      ],
      todayStr
    );

    var pickupTimeSlot = getInputValue_(
      data,
      [
        "pickupTimeSlot",
        "Pickup_Time_Slot",
        "pickup_time_slot"
      ],
      ""
    );

    // 依 Settings 與 Business_Calendar 再做一次伺服器端營業日檢查，
    // 避免前端停用選項被略過後，休息日仍收到新訂單。
    var orderSchedule = getBusinessScheduleForDate_(pickupDate, now);
    if (!orderSchedule.acceptingOrders) {
      throw new Error(orderSchedule.message || "目前不接受新訂單。");
    }
    if (!isConfiguredPickupSlot_(pickupTimeSlot, orderSchedule)) {
      throw new Error("所選取餐時段目前未開放，請重新選擇時段。");
    }

    var overallPepper = getInputValue_(
      data,
      [
        "overallPepper",
        "Overall_Pepper",
        "overall_pepper"
      ],
      "正常"
    );

    var overallChiliPowder = getInputValue_(
      data,
      [
        "overallChiliPowder",
        "Overall_Chili_Powder",
        "overall_chili_powder"
      ],
      "不加"
    );

    var overallChiliSauce = getInputValue_(
      data,
      [
        "overallChiliSauce",
        "Overall_Chili_Sauce",
        "overall_chili_sauce"
      ],
      "不加"
    );

    var vegSeparate = getInputValue_(
      data,
      [
        "vegSeparate",
        "Veg_Separate",
        "veg_separate"
      ],
      "否"
    );

    var extraPepper = Number(
      getInputValue_(
        data,
        [
          "extraPepper",
          "Extra_Pepper_Pack",
          "extra_pepper_pack"
        ],
        0
      )
    ) || 0;

    var extraChili = Number(
      getInputValue_(
        data,
        [
          "extraChili",
          "Extra_Chili_Pack",
          "extra_chili_pack"
        ],
        0
      )
    ) || 0;

    var extraSauce = Number(
      getInputValue_(
        data,
        [
          "extraSauce",
          "Extra_Sauce_Pack",
          "extra_sauce_pack"
        ],
        0
      )
    ) || 0;

    var promoCode = getInputValue_(
      data,
      [
        "promoCode",
        "Promo_Code_Used",
        "promo_code_used"
      ],
      ""
    );

    var remarks = getInputValue_(
      data,
      [
        "remarks",
        "Remarks",
        "remarks"
      ],
      ""
    );

    var totalAmount = Number(
      getInputValue_(
        data,
        [
          "totalAmount",
          "Total_Amount",
          "total_amount"
        ],
        0
      )
    ) || 0;

    var discountAmount = Number(
      getInputValue_(
        data,
        [
          "discountAmount",
          "Discount_Amount",
          "discount_amount"
        ],
        0
      )
    ) || 0;

    var paymentStatus = getInputValue_(
      data,
      [
        "paymentStatus",
        "Payment_Status",
        "payment_status"
      ],
      "未付款"
    );

    var orderStatus = getInputValue_(
      data,
      [
        "orderStatus",
        "Order_Status",
        "order_status"
      ],
      "新訂單"
    );

    var orderType = getInputValue_(
      data,
      [
        "orderType",
        "Order_Type",
        "order_type"
      ],
      "線上預訂"
    );


    /**
     * --------------------------------------------------------
     * 4-3. 整理商品明細
     * --------------------------------------------------------
     */

    var rawItems = getInputValue_(
      data,
      [
        "items"
      ],
      []
    );

    if (!Array.isArray(rawItems)) {
      rawItems = [];
    }

    if (rawItems.length === 0) {

      throw new Error(
        "訂單沒有商品明細，無法送出訂單。"
      );
    }


    var normalizedItems = [];

    for (var i = 0; i < rawItems.length; i++) {

      var item = rawItems[i] || {};

      var productId = getInputValue_(
        item,
        [
          "id",
          "productId",
          "product_id",
          "Product_ID"
        ],
        ""
      );

      var itemName = getInputValue_(
        item,
        [
          "name",
          "itemName",
          "item_name",
          "Item_Name"
        ],
        ""
      );

      var quantity = Number(
        getInputValue_(
          item,
          [
            "qty",
            "quantity",
            "Quantity"
          ],
          0
        )
      ) || 0;

      var unitPrice = Number(
        getInputValue_(
          item,
          [
            "price",
            "unitPrice",
            "unit_price",
            "Unit_Price"
          ],
          0
        )
      ) || 0;

      var subtotalValue = getInputValue_(
        item,
        [
          "subtotal",
          "Subtotal"
        ],
        null
      );

      var subtotal;

      if (
        subtotalValue !== null &&
        subtotalValue !== "" &&
        subtotalValue !== undefined
      ) {

        subtotal = Number(subtotalValue) || 0;

      } else {

        subtotal = quantity * unitPrice;

      }


      /**
       * ------------------------------------------------------
       * Is_Gift
       *
       * 這裡特別處理成真正的 Boolean
       *
       * TRUE  = 贈品
       * FALSE = 一般商品
       *
       * 不再寫入「是／否」
       * ------------------------------------------------------
       */
      var isGift = normalizeBoolean_(
        getInputValue_(
          item,
          [
            "isGift",
            "is_gift",
            "Is_Gift"
          ],
          false
        )
      );


      normalizedItems.push({

        Item_Entry_ID:
          orderId + "_" + (i + 1),

        Product_ID:
          String(productId || "").trim(),

        Item_Name:
          String(itemName || "").trim(),

        Quantity:
          quantity,

        Unit_Price:
          unitPrice,

        Subtotal:
          subtotal,

        Is_Gift:
          isGift

      });
    }


    /**
     * --------------------------------------------------------
     * 4-4. Orders
     * --------------------------------------------------------
     */

    var ordersSheet =
      ss.getSheetByName("Orders");

    if (!ordersSheet) {

      ordersSheet =
        ss.insertSheet("Orders");

      ordersSheet.appendRow([

        "Order_ID",
        "Customer_Order_Code",
        "LINE_UID",
        "Order_Time",
        "Pickup_Date",
        "Pickup_Time_Slot",
        "Customer_Name",
        "Customer_Phone",
        "Overall_Pepper",
        "Overall_Chili_Powder",
        "Overall_Chili_Sauce",
        "Veg_Separate",
        "Extra_Pepper_Pack",
        "Extra_Chili_Pack",
        "Extra_Sauce_Pack",
        "Total_Amount",
        "Discount_Amount",
        "Promo_Code_Used",
        "Payment_Status",
        "Order_Status",
        "Order_Type",
        "Remarks"

      ]);
    }


    /**
     * 取得 Orders 第一列欄位名稱
     */
    var ordersHeaderInfo =
      getHeaderInfo_(ordersSheet);

    var ordersHeaders =
      ordersHeaderInfo.headers;

    var customerOrderCode = generateCustomerOrderCode_(
      now,
      todayStr
    );

    /**
     * 建立「欄位名稱 → 值」
     *
     * 不使用固定欄號。
     */
    var ordersValues = {};

    setFieldAliases_(
      ordersValues,
      orderId,
      [
        "Order_ID",
        "訂單編號"
      ]
    );

    setFieldAliases_(
      ordersValues,
      customerOrderCode,
      [
        "Customer_Order_Code",
        "客戶訂單編號"
      ]
    );

    setFieldAliases_(
      ordersValues,
      lineUid,
      [
        "LINE_UID",
        "Line_UID",
        "下單用戶UID"
      ]
    );

    setFieldAliases_(
      ordersValues,
      timestamp,
      [
        "Order_Time",
        "Timestamp",
        "下單時間"
      ]
    );

    setFieldAliases_(
      ordersValues,
      pickupDate,
      [
        "Pickup_Date",
        "預約取餐日期"
      ]
    );

    setFieldAliases_(
      ordersValues,
      pickupTimeSlot,
      [
        "Pickup_Time_Slot",
        "預計取餐時段"
      ]
    );

    setFieldAliases_(
      ordersValues,
      customerName,
      [
        "Customer_Name",
        "客戶姓名"
      ]
    );

    setFieldAliases_(
      ordersValues,
      formattedPhone,
      [
        "Customer_Phone",
        "客戶電話"
      ]
    );

    setFieldAliases_(
      ordersValues,
      overallPepper,
      [
        "Overall_Pepper",
        "Pepper",
        "整單胡椒鹽(不加/小/中/大)"
      ]
    );

    setFieldAliases_(
      ordersValues,
      overallChiliPowder,
      [
        "Overall_Chili_Powder",
        "Chili_Powder",
        "整單辣椒粉(不加/小/中/大)"
      ]
    );

    setFieldAliases_(
      ordersValues,
      overallChiliSauce,
      [
        "Overall_Chili_Sauce",
        "Chili_Sauce",
        "整單辣醬(要/不加)"
      ]
    );

    setFieldAliases_(
      ordersValues,
      vegSeparate,
      [
        "Veg_Separate",
        "蔬菜分裝選項"
      ]
    );

    setFieldAliases_(
      ordersValues,
      extraPepper,
      [
        "Extra_Pepper_Pack",
        "胡椒鹽夾鏈包數量"
      ]
    );

    setFieldAliases_(
      ordersValues,
      extraChili,
      [
        "Extra_Chili_Pack",
        "辣椒粉夾鏈包數量"
      ]
    );

    setFieldAliases_(
      ordersValues,
      extraSauce,
      [
        "Extra_Sauce_Pack",
        "辣醬夾鏈包數量"
      ]
    );

    setFieldAliases_(
      ordersValues,
      totalAmount,
      [
        "Total_Amount",
        "實際結帳金額NT$"
      ]
    );

    setFieldAliases_(
      ordersValues,
      discountAmount,
      [
        "Discount_Amount",
        "折扣金額NT$"
      ]
    );

    setFieldAliases_(
      ordersValues,
      promoCode,
      [
        "Promo_Code_Used",
        "Promo_Code",
        "套用的行銷代碼"
      ]
    );

    setFieldAliases_(
      ordersValues,
      paymentStatus,
      [
        "Payment_Status",
        "付款狀態"
      ]
    );

    setFieldAliases_(
      ordersValues,
      orderStatus,
      [
        "Order_Status",
        "Status",
        "訂單狀態與叫號"
      ]
    );

    setFieldAliases_(
      ordersValues,
      orderType,
      [
        "Order_Type",
        "取餐類型"
      ]
    );

    setFieldAliases_(
      ordersValues,
      remarks,
      [
        "Remarks",
        "訂單備註(含優惠說明)"
      ]
    );


    /**
     * 根據實際欄位名稱建立整列資料
     */
    var ordersRowData =
      buildRowByHeaders_(
        ordersHeaders,
        ordersValues
      );


    /**
     * 寫入 Orders
     */
    ordersSheet
      .getRange(
        ordersSheet.getLastRow() + 1,
        1,
        1,
        ordersRowData.length
      )
      .setValues([ordersRowData]);


    /**
     * --------------------------------------------------------
     * 4-5. OrderItems
     * --------------------------------------------------------
     */

    var itemsSheet =
      ss.getSheetByName("OrderItems");

    if (!itemsSheet) {

      itemsSheet =
        ss.insertSheet("OrderItems");

      itemsSheet.appendRow([

        "Item_Entry_ID",
        "Order_ID",
        "Product_ID",
        "Item_Name",
        "Quantity",
        "Unit_Price",
        "Subtotal",
        "Is_Gift"

      ]);
    }


    var itemsHeaderInfo =
      getHeaderInfo_(itemsSheet);

    var itemsHeaders =
      itemsHeaderInfo.headers;


    /**
     * 一次建立所有明細列
     */
    var itemRows = [];

    for (var j = 0; j < normalizedItems.length; j++) {

      var normalizedItem =
        normalizedItems[j];

      var itemValues = {};

      setFieldAliases_(
        itemValues,
        normalizedItem.Item_Entry_ID,
        [
          "Item_Entry_ID",
          "明細編號"
        ]
      );

      setFieldAliases_(
        itemValues,
        orderId,
        [
          "Order_ID",
          "訂單編號"
        ]
      );

      setFieldAliases_(
        itemValues,
        normalizedItem.Product_ID,
        [
          "Product_ID",
          "商品編號"
        ]
      );

      setFieldAliases_(
        itemValues,
        normalizedItem.Item_Name,
        [
          "Item_Name",
          "品項名稱"
        ]
      );

      setFieldAliases_(
        itemValues,
        normalizedItem.Quantity,
        [
          "Quantity",
          "購買數量"
        ]
      );

      setFieldAliases_(
        itemValues,
        normalizedItem.Unit_Price,
        [
          "Unit_Price",
          "結帳單價"
        ]
      );

      setFieldAliases_(
        itemValues,
        normalizedItem.Subtotal,
        [
          "Subtotal",
          "小計公式"
        ]
      );


      /**
       * ★★★ 重要 ★★★
       *
       * Is_Gift 寫入真正 Boolean
       *
       * true  → Google Sheet TRUE
       * false → Google Sheet FALSE
       *
       * 不再使用：
       * "是"
       * "否"
       */
      setFieldAliases_(
        itemValues,
        normalizedItem.Is_Gift,
        [
          "Is_Gift",
          "是否為贈品(TRUE/FALSE)"
        ]
      );


      itemRows.push(
        buildRowByHeaders_(
          itemsHeaders,
          itemValues
        )
      );
    }


    /**
     * 一次寫入所有 OrderItems
     */
    if (itemRows.length > 0) {

      itemsSheet
        .getRange(
          itemsSheet.getLastRow() + 1,
          1,
          itemRows.length,
          itemsHeaders.length
        )
        .setValues(itemRows);
    }


    /**
     * --------------------------------------------------------
     * 4-6. 回傳給 index.html
     * --------------------------------------------------------
     */

    return {

      status: "success",

      order_id: orderId,

      Order_ID: orderId,

      customer_order_code: customerOrderCode,

      Customer_Order_Code: customerOrderCode,

      message: "訂單建立成功"

    };


  } catch (err) {

    Logger.log(
      "saveOrderData_ 錯誤: " +
      err.toString()
    );

    throw new Error(
      "訂單寫入失敗：" +
      err.toString()
    );

  } finally {

    try {
      lock.releaseLock();
    } catch (e) {
      // 忽略 Lock 釋放錯誤
    }

  }
}


/**
 * 每日產生客戶查詢編號：台北日期 yyyymmdd + 三位數流水號（001、002...）。
 * 例如 2026-10-25 的第一筆編號為 20261025001；查詢時另以完整電話號碼核對。
 * saveOrderData_ 會先取得 ScriptLock，確保同時下單時流水號不重複。
 */
function generateCustomerOrderCode_(now, todayStr) {
  var datePrefix = Utilities.formatDate(now, "Asia/Taipei", "yyyyMMdd");
  var properties = PropertiesService.getScriptProperties();
  var savedDate = properties.getProperty("CUSTOMER_ORDER_CODE_DATE");
  var nextSequence = savedDate === todayStr
    ? Number(properties.getProperty("CUSTOMER_ORDER_CODE_NEXT_SEQUENCE"))
    : 1;

  if (!isFinite(nextSequence) || nextSequence < 1 || Math.floor(nextSequence) !== nextSequence) {
    nextSequence = 1;
  }

  properties.setProperties({
    CUSTOMER_ORDER_CODE_DATE: todayStr,
    CUSTOMER_ORDER_CODE_NEXT_SEQUENCE: String(nextSequence + 1)
  });

  return datePrefix + String(nextSequence).padStart(3, "0");
}


/**
 * ============================================================
 * 5. 取得訂單資料供 PrintReceipt.html 使用
 * ============================================================
 */
function getOrderDetailsForReceipt(orderId) {

  try {

    var ss =
      SpreadsheetApp.getActiveSpreadsheet();

    var ordersSheet =
      ss.getSheetByName("Orders");

    var itemsSheet =
      ss.getSheetByName("OrderItems");

    var productsSheet =
      ss.getSheetByName("Products") ||
      ss.getSheetByName("products");


    if (!ordersSheet || !itemsSheet) {
      return null;
    }


    /**
     * --------------------------------------------------------
     * 5-1. 建立蔬菜 Product_ID 對照
     * --------------------------------------------------------
     */

    var vegProductIdSet = {};


    if (productsSheet) {

      var productsData =
        productsSheet
          .getDataRange()
          .getValues();

      if (productsData.length > 1) {

        var productHeaderInfo =
          getHeaderInfo_(productsSheet);

        var productHeaders =
          productHeaderInfo.headers;


        for (var p = 1; p < productsData.length; p++) {

          var productRow =
            productsData[p];

          var productId =
            String(
              getValueFromRowByHeaders_(
                productRow,
                productHeaders,
                [
                  "Product_ID",
                  "商品編號"
                ],
                ""
              )
            ).trim();


          var category =
            String(
              getValueFromRowByHeaders_(
                productRow,
                productHeaders,
                [
                  "Category",
                  "分類"
                ],
                ""
              )
            ).trim();


          var productName =
            String(
              getValueFromRowByHeaders_(
                productRow,
                productHeaders,
                [
                  "Item_Name",
                  "品項名稱",
                  "Online_Name",
                  "線上點餐名稱"
                ],
                ""
              )
            ).trim();


          /**
           * 排除 Products 第二列的欄位說明文字
           */
          if (
            productId === "商品編號" ||
            productId === "Product_ID"
          ) {
            continue;
          }


          if (
            productId &&
            (
              category.indexOf("蔬菜") !== -1 ||
              category.indexOf("青菜") !== -1 ||
              productId.toUpperCase().indexOf("V") === 0 ||
              productName.indexOf("蔬菜") !== -1 ||
              productName.indexOf("青菜") !== -1
            )
          ) {

            vegProductIdSet[
              productId.toUpperCase()
            ] = true;
          }
        }
      }
    }


    /**
     * --------------------------------------------------------
     * 5-2. 讀取 Orders
     * --------------------------------------------------------
     */

    var ordersData =
      ordersSheet
        .getDataRange()
        .getValues();

    if (ordersData.length <= 1) {
      return null;
    }


    var ordersHeaderInfo =
      getHeaderInfo_(ordersSheet);

    var ordersHeaders =
      ordersHeaderInfo.headers;


    var orderObj = null;


    for (var i = 1; i < ordersData.length; i++) {

      var orderRow =
        ordersData[i];

      var currentOrderId =
        String(
          getValueFromRowByHeaders_(
            orderRow,
            ordersHeaders,
            [
              "Order_ID",
              "訂單編號"
            ],
            ""
          )
        ).trim();


      if (
        currentOrderId ===
        String(orderId).trim()
      ) {

        var rawPhone =
          String(
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Customer_Phone",
                "客戶電話"
              ],
              ""
            )
          ).replace(/^'/, "");


        orderObj = {

          Order_ID:
            currentOrderId,

          Order_Time:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Order_Time",
                "Timestamp",
                "下單時間"
              ],
              ""
            ),

          Pickup_Time_Slot:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Pickup_Time_Slot",
                "預計取餐時段"
              ],
              ""
            ),

          Customer_Name:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Customer_Name",
                "客戶姓名"
              ],
              ""
            ),

          Customer_Phone:
            rawPhone,

          Overall_Pepper:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Overall_Pepper",
                "Pepper",
                "整單胡椒鹽(不加/小/中/大)"
              ],
              "正常"
            ) || "正常",

          Overall_Chili_Powder:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Overall_Chili_Powder",
                "Chili_Powder",
                "整單辣椒粉(不加/小/中/大)"
              ],
              "不加"
            ) || "不加",

          Overall_Chili_Sauce:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Overall_Chili_Sauce",
                "Chili_Sauce",
                "整單辣醬(要/不加)"
              ],
              "不加"
            ) || "不加",

          Veg_Separate:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Veg_Separate",
                "蔬菜分裝選項"
              ],
              "否"
            ) || "否",

          Total_Amount:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Total_Amount",
                "實際結帳金額NT$"
              ],
              0
            ) || 0,

          Discount_Amount:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Discount_Amount",
                "折扣金額NT$"
              ],
              0
            ) || 0,

          Remarks:
            getValueFromRowByHeaders_(
              orderRow,
              ordersHeaders,
              [
                "Remarks",
                "訂單備註(含優惠說明)"
              ],
              ""
            ) || ""
        };

        break;
      }
    }


    if (!orderObj) {
      return null;
    }


    /**
     * --------------------------------------------------------
     * 5-3. 讀取 OrderItems
     * --------------------------------------------------------
     */

    var itemsData =
      itemsSheet
        .getDataRange()
        .getValues();

    if (itemsData.length <= 1) {

      orderObj.items = [];
      orderObj.normalItems = [];
      orderObj.vegItems = [];

      return orderObj;
    }


    var itemsHeaderInfo =
      getHeaderInfo_(itemsSheet);

    var itemsHeaders =
      itemsHeaderInfo.headers;


    var allItems = [];
    var normalItems = [];
    var vegItems = [];


    for (var j = 1; j < itemsData.length; j++) {

      var itemRow =
        itemsData[j];


      var itemOrderId =
        String(
          getValueFromRowByHeaders_(
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
        String(orderId).trim()
      ) {

        continue;
      }


      var productId =
        String(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            [
              "Product_ID",
              "商品編號"
            ],
            ""
          )
        ).trim();


      var itemName =
        String(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            [
              "Item_Name",
              "品項名稱"
            ],
            ""
          )
        ).trim();


      var qty =
        Number(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            [
              "Quantity",
              "購買數量"
            ],
            0
          )
        ) || 0;


      var unitPrice =
        Number(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            [
              "Unit_Price",
              "結帳單價"
            ],
            0
          )
        ) || 0;


      var subtotal =
        Number(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            [
              "Subtotal",
              "小計公式"
            ],
            0
          )
        ) || (qty * unitPrice);


      var isGift =
        normalizeBoolean_(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            [
              "Is_Gift",
              "是否為贈品(TRUE/FALSE)"
            ],
            false
          )
        );


      var itemObj = {

        Product_ID:
          productId,

        Item_Name:
          itemName,

        Quantity:
          qty,

        Unit_Price:
          unitPrice,

        Subtotal:
          subtotal,

        Is_Gift:
          isGift
      };


      allItems.push(itemObj);


      /**
       * 判斷是否為蔬菜 / 青菜
       */
      var pidUpper =
        productId.toUpperCase();


      if (
        vegProductIdSet[pidUpper] ||
        pidUpper.indexOf("V") === 0 ||
        itemName.indexOf("青菜") !== -1 ||
        itemName.indexOf("蔬菜") !== -1
      ) {

        vegItems.push(itemObj);

      } else {

        normalItems.push(itemObj);
      }
    }


    orderObj.items =
      allItems;

    orderObj.normalItems =
      normalItems;

    orderObj.vegItems =
      vegItems;


    return orderObj;


  } catch (err) {

    Logger.log(
      "getOrderDetailsForReceipt 發生錯誤: " +
      err.toString()
    );

    return null;
  }
}

/**
 * ============================================================
 * 6. 顧客訂單查詢／訂單狀態
 *
 * 查詢條件：
 * 訂單編號 + 電話
 *
 * 回傳：
 * 訂單基本資料 + 商品明細
 * ============================================================
 */
function getOrderStatus(orderId, phone) {

  try {

    /**
     * --------------------------------------------------------
     * 6-1. 基本資料檢查
     * --------------------------------------------------------
     */
    orderId = String(orderId || "").trim().toUpperCase();
    phone = String(phone || "")
      .trim()
      .replace(/^'/, "")
      .replace(/[\s-]/g, "");

    if (!orderId) {
      return {
        status: "error",
        message: "請輸入訂單編號。"
      };
    }

    if (!phone) {
      return {
        status: "error",
        message: "請輸入電話號碼。"
      };
    }


    /**
     * --------------------------------------------------------
     * 6-2. 取得工作表
     * --------------------------------------------------------
     */
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ordersSheet = ss.getSheetByName("Orders");
    var itemsSheet = ss.getSheetByName("OrderItems");

    if (!ordersSheet || !itemsSheet) {
      return {
        status: "error",
        message: "訂單資料庫不存在。"
      };
    }


    /**
     * --------------------------------------------------------
     * 6-3. 讀取 Orders
     * --------------------------------------------------------
     */
    var ordersData = ordersSheet.getDataRange().getValues();

    if (ordersData.length <= 1) {
      return {
        status: "error",
        message: "查無訂單資料。"
      };
    }

    var ordersHeaders =
      getHeaderInfo_(ordersSheet).headers;

    var orderObj = null;
    var matchedOrderId = "";

    for (var i = 1; i < ordersData.length; i++) {

      var row = ordersData[i];

      var currentOrderId = String(
        getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Order_ID", "訂單編號"],
          ""
        )
      ).trim();

      var currentCustomerOrderCode = String(
        getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Customer_Order_Code", "客戶訂單編號"],
          ""
        )
      ).trim();

      if (
        currentOrderId !== orderId &&
        currentCustomerOrderCode !== orderId
      ) {
        continue;
      }

      var storedPhone = operatorPhoneWithLeadingZero_(
        getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Customer_Phone", "客戶電話"],
          ""
        )
      ).replace(/[\s-]/g, "");

      if (storedPhone !== phone) {
        return {
          status: "error",
          message: "訂單編號或電話號碼不正確。"
        };
      }

      matchedOrderId = currentOrderId;

      orderObj = {
        status: "success",

        order_id: currentOrderId,

        customer_order_code: currentCustomerOrderCode,

        order_time: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Order_Time", "Timestamp", "下單時間"],
          ""
        ),

        pickup_date: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Pickup_Date", "預約取餐日期"],
          ""
        ),

        pickup_time_slot: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Pickup_Time_Slot", "預計取餐時段"],
          ""
        ),

        customer_name: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Customer_Name", "客戶姓名"],
          ""
        ),

        total_amount: Number(
          getValueFromRowByHeaders_(
            row,
            ordersHeaders,
            ["Total_Amount", "實際結帳金額NT$"],
            0
          )
        ) || 0,

        payment_status: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Payment_Status", "付款狀態"],
          ""
        ),

        overall_pepper: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Overall_Pepper", "整單胡椒鹽(不加/小/中/大)", "整單胡椒鹽"],
          ""
        ),

        overall_chili_powder: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Overall_Chili_Powder", "整單辣椒粉(不加/小/中/大)", "整單辣椒粉"],
          ""
        ),

        overall_chili_sauce: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Overall_Chili_Sauce", "整單辣醬(要/不加)", "整單辣醬"],
          ""
        ),

        veg_separate: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Veg_Separate", "蔬菜分裝選項", "蔬菜分裝"],
          ""
        ),

        extra_pepper_pack: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Extra_Pepper_Pack", "胡椒鹽夾鏈包數量"],
          0
        ),

        extra_chili_pack: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Extra_Chili_Pack", "辣椒粉夾鏈包數量"],
          0
        ),

        extra_sauce_pack: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Extra_Sauce_Pack", "辣醬夾鏈包數量"],
          0
        ),

        discount_amount: Number(
          getValueFromRowByHeaders_(
            row,
            ordersHeaders,
            ["Discount_Amount", "折扣金額NT$", "折扣金額"],
            0
          )
        ) || 0,

        promo_code_used: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Promo_Code_Used", "套用的行銷代碼"],
          ""
        ),

        order_status: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Order_Status", "Status", "訂單狀態與叫號"],
          "新訂單"
        ),

        order_type: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Order_Type", "取餐類型"],
          ""
        ),

        remarks: getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Remarks", "訂單備註(含優惠說明)"],
          ""
        ),

        items: []
      };

      break;
    }

    if (!orderObj) {
      return {
        status: "error",
        message: "訂單編號或電話號碼不正確。"
      };
    }


    /**
     * --------------------------------------------------------
     * 6-4. 讀取 OrderItems
     * --------------------------------------------------------
     */
    var itemsData = itemsSheet.getDataRange().getValues();

    if (itemsData.length <= 1) {
      return orderObj;
    }

    var itemsHeaders =
      getHeaderInfo_(itemsSheet).headers;


    /**
     * --------------------------------------------------------
     * 6-5. 建立商品明細
     * --------------------------------------------------------
     */
    for (var j = 1; j < itemsData.length; j++) {

      var itemRow = itemsData[j];

      var itemOrderId = String(
        getValueFromRowByHeaders_(
          itemRow,
          itemsHeaders,
          ["Order_ID", "訂單編號"],
          ""
        )
      ).trim();

      if (itemOrderId !== matchedOrderId) {
        continue;
      }

      var item = {

        product_id: String(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            ["Product_ID", "商品編號"],
            ""
          )
        ).trim(),

        item_name: String(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            ["Item_Name", "品項名稱"],
            ""
          )
        ).trim(),

        quantity: Number(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            ["Quantity", "購買數量"],
            0
          )
        ) || 0,

        unit_price: Number(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            ["Unit_Price", "結帳單價"],
            0
          )
        ) || 0,

        subtotal: Number(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            ["Subtotal", "小計公式"],
            0
          )
        ) || 0,

        is_gift: normalizeBoolean_(
          getValueFromRowByHeaders_(
            itemRow,
            itemsHeaders,
            ["Is_Gift", "是否為贈品(TRUE/FALSE)"],
            false
          )
        )
      };

      orderObj.items.push(item);
    }


    /**
     * --------------------------------------------------------
     * 6-6. 回傳
     * --------------------------------------------------------
     */
    return orderObj;

  } catch (err) {

    Logger.log(
      "getOrderStatus 發生錯誤: " +
      err.toString()
    );

    return {
      status: "error",
      message: "查詢訂單時發生錯誤。"
    };
  }
}


/**
 * ============================================================
 * 7. 外部 HTTP POST
 * ============================================================
 */
function doPost(e) {

  if (e && e.parameter && e.parameter.operatorWrite === "1") {
    return handleOperatorWritePost_(e);
  }

  if (e && e.parameter && e.parameter.operatorRead === "1") {
    return handleOperatorReadPost_(e);
  }

  // 現場作業頁 Google 登入請求；其他 POST 維持原有訂單處理流程。
  if (e && e.parameter && e.parameter.operatorAuth === "1") {
    return handleOperatorAuthPost_(e);
  }

  // 顧客訂單查詢頁取消訂單；取消時由後端再次核對訂單編號與完整電話。
  if (e && e.parameter && e.parameter.customerCancel === "1") {
    return handleCustomerCancelPost_(e);
  }

  var isFormPost =
    !!(
      e &&
      e.parameter &&
      e.parameter.payload
    );

  try {

    if (!e) {

      return ContentService
        .createTextOutput(
          JSON.stringify({
            status: "error",
            message:
              "沒有收到 HTTP POST 請求。"
          })
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );
    }


    var data;


    /**
     * GitHub Pages：
     * 訂單資料會放在 e.parameter.payload
     */
    if (isFormPost) {

      data =
        JSON.parse(
          e.parameter.payload
        );

    }


    /**
     * 保留原本 JSON POST 的相容性
     */
    else if (
      e.postData &&
      e.postData.contents
    ) {

      data =
        JSON.parse(
          e.postData.contents
        );

    }


    /**
     * 沒有收到有效訂單資料
     */
    else {

      return ContentService
        .createTextOutput(
          JSON.stringify({
            status: "error",
            message:
              "沒有收到訂單資料。"
          })
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );
    }


    /**
     * 統一走新的訂單寫入流程
     */
    var result =
      submitOrderData(data);


    /**
     * GitHub Pages：
     * 透過隱藏 iframe 回傳結果
     */
    if (isFormPost) {

      var message =
        JSON.stringify({
          type:
            "XIAKA_ORDER_RESULT",
          result:
            result
        }).replace(
          /</g,
          "\\u003c"
        );


      return HtmlService
        .createHtmlOutput(
          "<script>" +
          "window.top.postMessage(" +
          message +
          ", '*');" +
          "</script>"
        );
    }


    /**
     * 原本 JSON POST：
     * 維持 JSON 回傳
     */
    return ContentService
      .createTextOutput(
        JSON.stringify(result)
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );


  } catch (err) {

    Logger.log(
      "doPost Error: " +
      err.toString()
    );


    var errorResult = {
      status:
        "error",
      message:
        err.toString()
    };


    /**
     * GitHub Pages：
     * 發生錯誤時也通知前端
     */
    if (isFormPost) {

      var errorMessage =
        JSON.stringify({
          type:
            "XIAKA_ORDER_RESULT",
          result:
            errorResult
        }).replace(
          /</g,
          "\\u003c"
        );


      return HtmlService
        .createHtmlOutput(
          "<script>" +
          "window.top.postMessage(" +
          errorMessage +
          ", '*');" +
          "</script>"
        );
    }


    /**
     * 原本 JSON POST：
     * 維持 JSON 錯誤回傳
     */
    return ContentService
      .createTextOutput(
        JSON.stringify(errorResult)
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );
  }
}


/**
 * 顧客取消訂單 POST 入口。瀏覽器以 no-cors 發送，前端再讀取訂單狀態確認寫入結果。
 */
function handleCustomerCancelPost_(e) {
  var result;
  try {
    var payload = JSON.parse((e.parameter && e.parameter.customerCancelPayload) || "{}");
    result = cancelCustomerOrder_(payload.orderId, payload.phone);
  } catch (err) {
    result = {
      status: "error",
      message: err && err.message ? err.message : "取消訂單失敗。"
    };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 以客戶訂單編號（或舊制 Order_ID）及完整電話核對後，更新訂單狀態。
 */
function cancelCustomerOrder_(orderId, phone) {
  orderId = String(orderId || "").trim().toUpperCase();
  phone = String(phone || "").trim().replace(/^'/, "").replace(/[\s-]/g, "");
  if (!orderId || !phone) {
    throw new Error("請提供客戶訂單編號和完整電話號碼。 ");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss && ss.getSheetByName("Orders");
    if (!sheet || sheet.getLastRow() < 2) {
      throw new Error("查無訂單資料。 ");
    }

    var headerInfo = getHeaderInfo_(sheet);
    var headers = headerInfo.headers;
    var statusColumn = -1;
    ["Order_Status", "Status", "訂單狀態與叫號"].some(function (name) {
      var index = headerInfo.indexByKey[normalizeHeader_(name)];
      if (index !== undefined) {
        statusColumn = index;
        return true;
      }
      return false;
    });
    if (statusColumn < 0) {
      throw new Error("Orders 工作表找不到訂單狀態欄位。 ");
    }

    var workStatusColumn = headerInfo.indexByKey[normalizeHeader_("Work_Status")];
    var rows = sheet.getDataRange().getValues();
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var rowOrderId = String(getValueFromRowByHeaders_(
        row, headers, ["Order_ID", "訂單編號"], ""
      )).trim().toUpperCase();
      var rowCustomerCode = String(getValueFromRowByHeaders_(
        row, headers, ["Customer_Order_Code", "客戶訂單編號"], ""
      )).trim().toUpperCase();

      if (rowOrderId !== orderId && rowCustomerCode !== orderId) continue;

      var storedPhone = operatorPhoneWithLeadingZero_(getValueFromRowByHeaders_(
        row, headers, ["Customer_Phone", "客戶電話"], ""
      )).replace(/[\s-]/g, "");
      if (storedPhone !== phone) {
        throw new Error("訂單編號或完整電話號碼不正確。 ");
      }

      var currentStatus = String(row[statusColumn] || "").trim().toLowerCase();
      var currentWorkStatus = workStatusColumn === undefined
        ? ""
        : String(row[workStatusColumn] || "").trim().toLowerCase();
      if (["已完成", "完成", "completed"].indexOf(currentStatus) >= 0 ||
          ["已完成", "完成", "completed"].indexOf(currentWorkStatus) >= 0) {
        throw new Error("此訂單已完成，無法由顧客取消。 ");
      }

      if (["已取消", "取消", "cancelled"].indexOf(currentStatus) < 0) {
        sheet.getRange(r + 1, statusColumn + 1).setValue("已取消");
      }
      if (workStatusColumn !== undefined &&
          ["已取消", "取消", "cancelled"].indexOf(currentWorkStatus) < 0) {
        sheet.getRange(r + 1, workStatusColumn + 1).setValue("已取消");
      }

      return { status: "success", order_status: "已取消" };
    }

    throw new Error("查無符合的訂單。 ");
  } finally {
    lock.releaseLock();
  }
}


/**
 * ============================================================
 * 8. 讀取 Products 給前端
 * ============================================================
 */
function getProductsForFrontend() {

  try {

    var ss =
      SpreadsheetApp.getActiveSpreadsheet();

    var sheet =
      ss.getSheetByName("Products") ||
      ss.getSheetByName("products");


    if (!sheet) {

      Logger.log(
        "找不到名為 'Products' 的工作表！"
      );

      return [];
    }


    var data =
      sheet
        .getDataRange()
        .getValues();


    if (data.length <= 1) {

      return [];
    }


    var headerInfo =
      getHeaderInfo_(sheet);

    var headers =
      headerInfo.headers;


    var products = [];


    for (var i = 1; i < data.length; i++) {

      var row =
        data[i];

      var productObj = {};


      /**
       * 依照實際欄位名稱建立物件
       */
      for (var j = 0; j < headers.length; j++) {

        var header =
          String(headers[j] || "").trim();

        if (!header) {
          continue;
        }


        var cellValue =
          row[j];


        if (cellValue instanceof Date) {

          cellValue =
            Utilities.formatDate(
              cellValue,
              "Asia/Taipei",
              "yyyy-MM-dd HH:mm:ss"
            );
        }


        productObj[header] =
          (
            cellValue !== undefined &&
            cellValue !== null
          )
            ? cellValue
            : "";
      }


      var productId =
        String(
          getValueFromRowByHeaders_(
            row,
            headers,
            [
              "Product_ID",
              "商品編號"
            ],
            ""
          )
        ).trim();


      var itemName =
        String(
          getValueFromRowByHeaders_(
            row,
            headers,
            [
              "Item_Name",
              "品項名稱"
            ],
            ""
          )
        ).trim();


      var onlineName =
        String(
          getValueFromRowByHeaders_(
            row,
            headers,
            [
              "Online_Name",
              "線上點餐名稱"
            ],
            ""
          )
        ).trim();


      /**
       * 排除空白資料列
       */
      if (!productId && !itemName && !onlineName) {
        continue;
      }


      /**
       * 排除第二列的欄位說明
       *
       * 例如：
       * Product_ID = 商品編號
       * Item_Name = 品項名稱
       */
      if (
        productId === "商品編號" ||
        productId === "Product_ID" ||
        itemName === "品項名稱"
      ) {

        continue;
      }


      /**
       * 讀取商品 Status
       */
      var statusStr =
        String(
          getValueFromRowByHeaders_(
            row,
            headers,
            [
              "Status",
              "狀態"
            ],
            ""
          )
        )
        .trim()
        .toUpperCase();


      /**
       * 空白、上架、ACTIVE、營業中、TRUE、1
       * 視為可以提供前端使用
       */
      if (
        !statusStr ||
        statusStr === "上架" ||
        statusStr === "ACTIVE" ||
        statusStr === "營業中" ||
        statusStr === "TRUE" ||
        statusStr === "1"
      ) {

        products.push(productObj);
      }
    }


    Logger.log(
      "成功抓取商品數量：" +
      products.length +
      " 筆"
    );


    return products;


  } catch (err) {

    Logger.log(
      "getProductsForFrontend 發生錯誤: " +
      err.toString()
    );

    return [];
  }
}


/**
 * ============================================================
 * 9. 讀取 CATALOG_RULES
 * ============================================================
 */
function getCatalogRules() {

  var diagnosticStartedAt = Date.now();
  var diagnosticStageAt = diagnosticStartedAt;

  try {

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log(
      "[GAS-DIAG] getCatalogRules 開啟 Spreadsheet：" +
      (Date.now() - diagnosticStageAt) +
      " ms"
    );
    diagnosticStageAt = Date.now();

    var sheet =
      ss.getSheetByName("CATALOG_RULES") ||
      ss.getSheetByName("catalog_rules") ||
      ss.getSheetByName("Catalog_Rules");
    Logger.log(
      "[GAS-DIAG] getCatalogRules 尋找工作表：" +
      (Date.now() - diagnosticStageAt) +
      " ms"
    );

    if (!sheet) {

      Logger.log("未找到 CATALOG_RULES 工作表");

      return [];
    }


    diagnosticStageAt = Date.now();
    var data = sheet.getDataRange().getValues();
    Logger.log(
      "[GAS-DIAG] getCatalogRules 讀取儲存格：" +
      (Date.now() - diagnosticStageAt) +
      " ms；範圍 " +
      data.length +
      " 列 × " +
      (data.length ? data[0].length : 0) +
      " 欄"
    );
    diagnosticStageAt = Date.now();

    if (!data || data.length === 0) {

      return [];
    }


    /*
     * ============================================================
     * ① 自動尋找真正的欄位標題列
     *
     * CATALOG_RULES 目前結構：
     *
     * 第1列：說明標題
     * 第2列：Prefix
     * 第3列：前綴代碼 | 分類名稱 | ...
     *
     * 所以不能固定使用第1列當 Header。
     * ============================================================
     */

    var headerRowIndex = -1;


    for (var r = 0; r < data.length; r++) {

      var row = data[r];

      var hasPrefixHeader = false;
      var hasCategoryHeader = false;


      for (var c = 0; c < row.length; c++) {

        var cell =
          String(row[c] || "")
            .trim();


        if (
          cell === "前綴代碼" ||
          cell === "Prefix"
        ) {

          hasPrefixHeader = true;
        }


        if (
          cell === "分類名稱" ||
          cell === "Category_Name" ||
          cell === "Category Name"
        ) {

          hasCategoryHeader = true;
        }
      }


      if (
        hasPrefixHeader &&
        hasCategoryHeader
      ) {

        headerRowIndex = r;

        break;
      }
    }


    if (headerRowIndex === -1) {

      Logger.log(
        "CATALOG_RULES 找不到正式欄位標題列"
      );

      Logger.log(
        "目前資料：" +
        JSON.stringify(data)
      );

      return [];
    }


    Logger.log(
      "CATALOG_RULES 正式標題列：" +
      (headerRowIndex + 1)
    );


    /*
     * ============================================================
     * ② 取得正式 Header
     * ============================================================
     */

    var headers = data[headerRowIndex];


    Logger.log(
      "CATALOG_RULES Headers：" +
      JSON.stringify(headers)
    );


    /*
     * ============================================================
     * ③ 找出 Prefix 與分類名稱欄位
     *
     * 仍然以欄位名稱判斷，不依賴固定欄號。
     * ============================================================
     */

    var prefixHeaderIndex = -1;
    var categoryHeaderIndex = -1;


    for (var h = 0; h < headers.length; h++) {

      var header =
        String(headers[h] || "")
          .trim();


      if (
        header === "前綴代碼" ||
        header === "Prefix"
      ) {

        prefixHeaderIndex = h;
      }


      if (
        header === "分類名稱" ||
        header === "Category_Name" ||
        header === "Category Name"
      ) {

        categoryHeaderIndex = h;
      }
    }


    if (
      prefixHeaderIndex === -1 ||
      categoryHeaderIndex === -1
    ) {

      Logger.log(
        "CATALOG_RULES 找不到 Prefix 或分類名稱欄位"
      );

      return [];
    }


    /*
     * ============================================================
     * ④ 從正式 Header 下一列開始讀取資料
     * ============================================================
     */

    var rules = [];


    for (
      var i = headerRowIndex + 1;
      i < data.length;
      i++
    ) {

      var row = data[i];


      var prefix =
        String(
          row[prefixHeaderIndex] || ""
        )
        .trim()
        .toUpperCase();


      var categoryName =
        String(
          row[categoryHeaderIndex] || ""
        )
        .trim();


      /*
       * 空白資料列直接跳過
       */

      if (!prefix && !categoryName) {

        continue;
      }


      /*
       * 沒有 Prefix 的資料不是分類規則
       */

      if (!prefix) {

        continue;
      }


      /*
       * ==========================================================
       * 統一回傳格式
       *
       * index.html 只需要使用：
       *
       * rule.Prefix
       * rule.Category_Name
       * ==========================================================
       */

      var ruleObj = {

        Prefix: prefix,

        Category_Name: categoryName

      };


      /*
       * 同時保留 CATALOG_RULES 原始欄位
       * 方便未來其他功能使用。
       */

      for (
        var j = 0;
        j < headers.length;
        j++
      ) {

        var originalHeader =
          String(headers[j] || "")
            .trim();


        if (!originalHeader) {

          continue;
        }


        var value = row[j];


        if (
          value !== undefined &&
          value !== null
        ) {

          if (value instanceof Date) {

            value =
              Utilities.formatDate(
                value,
                "Asia/Taipei",
                "yyyy-MM-dd"
              );

          } else {

            value =
              String(value).trim();

          }

        } else {

          value = "";
        }


        ruleObj[originalHeader] = value;
      }


      rules.push(ruleObj);
    }


    /*
     * ============================================================
     * ⑤ 記錄診斷資訊
     * ============================================================
     */

    Logger.log(
      "getCatalogRules 成功讀取：" +
      rules.length +
      " 筆；整理資料：" +
      (Date.now() - diagnosticStageAt) +
      " ms；函式總時間：" +
      (Date.now() - diagnosticStartedAt) +
      " ms"
    );


    if (rules.length > 0) {

      Logger.log(
        "第一筆 CATALOG_RULES：" +
        JSON.stringify(rules[0])
      );

    }


    return rules;


  } catch (err) {

    Logger.log(
      "getCatalogRules 錯誤：" +
      err.toString() +
      "；函式總時間：" +
      (Date.now() - diagnosticStartedAt) +
      " ms"
    );

    return [];
  }
}


/**
 * ============================================================
 * 10. 取得 Settings 分頁的營業設定
 *
 * 目前保留原本設定邏輯。
 * ============================================================
 */
function getStoreSettings() {

  var now = new Date();
  var date = Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd");
  var schedule = getBusinessScheduleForDate_(date, now);
  return {
    openTime: schedule.openTime,
    closeTime: schedule.closeTime,
    pickupStartTime: schedule.pickupStartTime,
    pickupEndTime: schedule.pickupEndTime,
    pickupIntervalMinutes: schedule.pickupIntervalMinutes,
    disabledSlots: schedule.disabledSlots,
    businessDays: schedule.businessDays,
    isOpenDay: schedule.isOpenDay,
    acceptingOrders: schedule.acceptingOrders,
    closedReason: schedule.message,
    specialNote: schedule.note,
    businessType: schedule.businessType
  };
}

/** 依全店狀態 > 指定日期例外 > 每週營業日套用營業規則。 */
function getBusinessScheduleForDate_(dateValue, now) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settingsRows = operatorReadRows_(ss, "Settings");
  var settings = {};
  settingsRows.forEach(function (row) {
    var key = String(row.Setting_Key || "").trim();
    if (key) settings[key] = row.Setting_Value;
  });

  var date = dateValue instanceof Date
    ? Utilities.formatDate(dateValue, "Asia/Taipei", "yyyy-MM-dd")
    : String(dateValue || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = Utilities.formatDate(now || new Date(), "Asia/Taipei", "yyyy-MM-dd");
  }

  var businessDays = String(settings.Business_Days || "MON,TUE,WED,THU,FRI,SAT,SUN")
    .toUpperCase().split(/[\s,，]+/).filter(function (day) { return !!day; });
  var dayCodes = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  var utcDay = new Date(date + "T12:00:00Z").getUTCDay();
  var weeklyOpen = businessDays.indexOf(dayCodes[utcDay]) >= 0;
  var openTime = operatorFormatTime_(settings.Auto_Open_Time) || "06:00";
  var closeTime = operatorFormatTime_(settings.Auto_Close_Time) || "17:30";
  var pickupStart = operatorFormatTime_(settings.Pickup_Start_Time) || "16:00";
  var pickupEnd = operatorFormatTime_(settings.Pickup_End_Time) || "17:30";
  var interval = Number(settings.Pickup_Slot_Interval_Minutes) || 30;
  var disabledSlots = String(settings.Disabled_Time_Slots || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
  var globalClosed = String(settings.Store_Status || "OPEN").trim().toUpperCase() === "CLOSED";
  var exception = operatorReadRows_(ss, "Business_Calendar").filter(function (row) {
    return operatorFormatDate_(row.Business_Date, "yyyy-MM-dd") === date;
  })[0] || null;

  var businessType = exception ? String(exception.Business_Type || "").trim().toUpperCase() : "";
  // 舊版欄位相容：若分頁尚未改用 Business_Type，仍辨識 Is_Closed。
  if (!businessType && exception && (exception.Is_Closed === true || ["TRUE", "1", "是", "休息"].indexOf(String(exception.Is_Closed || "").trim().toUpperCase()) >= 0)) {
    businessType = "CLOSED";
  }
  var isClosedException = businessType === "CLOSED";
  var isSpecialOpen = businessType === "SPECIAL_OPEN";
  var isOpenDay = isSpecialOpen || (!isClosedException && weeklyOpen);
  var note = exception ? String(exception.Note || exception.Special_Note || "") : "";

  if (exception && isSpecialOpen) {
    openTime = operatorFormatTime_(exception.Order_Open_Time) || openTime;
    closeTime = operatorFormatTime_(exception.Order_Close_Time) || closeTime;
    pickupStart = operatorFormatTime_(exception.Pickup_Start_Time) || pickupStart;
    pickupEnd = operatorFormatTime_(exception.Pickup_End_Time) || pickupEnd;
    interval = Number(exception.Pickup_Slot_Interval_Minutes) || interval;
  }

  var acceptingOrders = isOpenDay && !globalClosed;
  var message = "";
  if (globalClosed) message = "店鋪目前全店暫停接單。";
  else if (isClosedException) message = note || "本日店休，不接受新訂單。";
  else if (!isOpenDay) message = "本日為每週公休日，不接受新訂單。";

  // 自動開關店時間也在伺服器端檢查；處理跨午夜的營業時段。
  if (acceptingOrders && now && date === Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd")) {
    var current = Number(Utilities.formatDate(now, "Asia/Taipei", "HHmm"));
    var start = Number(openTime.replace(":", ""));
    var end = Number(closeTime.replace(":", ""));
    var withinHours = start <= end ? current >= start && current < end : current >= start || current < end;
    if (!withinHours) {
      acceptingOrders = false;
      message = "目前不在訂餐網頁開放時間（" + openTime + "–" + closeTime + "）。";
    }
  }

  return {
    date: date, openTime: openTime, closeTime: closeTime,
    pickupStartTime: pickupStart, pickupEndTime: pickupEnd,
    pickupIntervalMinutes: interval, disabledSlots: disabledSlots,
    businessDays: businessDays, isOpenDay: isOpenDay,
    acceptingOrders: acceptingOrders, globalClosed: globalClosed,
    businessType: businessType || (weeklyOpen ? "REGULAR" : "CLOSED"),
    note: note, message: message
  };
}

function isConfiguredPickupSlot_(slotValue, schedule) {
  var match = String(slotValue || "").match(/(\d{1,2}:\d{2})\s*[-–至]\s*(\d{1,2}:\d{2})/);
  if (!match) return false;
  function minutes(value) {
    var parts = value.split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  var selectedStart = minutes(match[1]);
  var selectedEnd = minutes(match[2]);
  var rangeStart = minutes(schedule.pickupStartTime);
  var rangeEnd = minutes(schedule.pickupEndTime);
  var interval = Number(schedule.pickupIntervalMinutes) || 30;
  if (selectedStart < rangeStart || selectedEnd > rangeEnd || selectedEnd <= selectedStart) return false;
  if ((selectedStart - rangeStart) % interval !== 0 || selectedEnd !== Math.min(selectedStart + interval, rangeEnd)) return false;
  var disabled = schedule.disabledSlots || [];
  for (var i = 0; i < disabled.length; i++) {
    var blocked = String(disabled[i]).replace(/\s/g, "").match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
    if (blocked && selectedStart < minutes(blocked[2]) && selectedEnd > minutes(blocked[1])) return false;
  }
  return true;
}


/**
 * ============================================================
 * 11. 時間解析
 * ============================================================
 */
function parseTimeString(
  val,
  defaultTime
) {

  if (!val) {
    return defaultTime;
  }


  if (val instanceof Date) {

    return Utilities.formatDate(
      val,
      "Asia/Taipei",
      "HH:mm"
    );
  }


  var str =
    String(val)
      .trim()
      .replace(/：/g, ":");


  /**
   * 中文上午 / 下午
   */
  if (
    str.indexOf("下午") !== -1 ||
    str.indexOf("上午") !== -1
  ) {

    var isPM =
      str.indexOf("下午") !== -1;


    var timePart =
      str
        .replace(/[上下]午/g, "")
        .trim();


    var parts =
      timePart.split(":");


    var h =
      parseInt(
        parts[0],
        10
      ) || 0;


    var m =
      parseInt(
        parts[1],
        10
      ) || 0;


    if (
      isPM &&
      h < 12
    ) {

      h += 12;
    }


    if (
      !isPM &&
      h === 12
    ) {

      h = 0;
    }


    return (
      String(h).padStart(2, "0") +
      ":" +
      String(m).padStart(2, "0")
    );
  }


  /**
   * 一般 HH:mm
   */
  var parts =
    str.split(":");


  if (parts.length >= 2) {

    var hour =
      parseInt(
        parts[0],
        10
      ) || 0;


    var minute =
      parseInt(
        parts[1],
        10
      ) || 0;


    return (
      String(hour).padStart(2, "0") +
      ":" +
      String(minute).padStart(2, "0")
    );
  }


  return defaultTime;
}


/**
 * ============================================================
 * 12. Google Sheet 開啟時建立選單
 * ============================================================
 */
function onOpen() {

  var ui =
    SpreadsheetApp.getUi();


  ui.createMenu(
    '🔥 呷喀智慧營運系統'
  )

    .addItem(
      '🛒 開啟顧客點餐網頁',
      'openOrderPage'
    )

    .addToUi();
}


/**
 * ============================================================
 * 13. 開啟點餐網頁
 * ============================================================
 */
function openOrderPage() {

  var WEB_APP_URL =
    "https://script.google.com/macros/s/AKfycbzvNQOzzm16906irmZtSA_3mfWO2GDWqZSjTVEMa3Ao5A638n-JdfrRYov197A_DM1TOA/exec";


  var html =
    HtmlService.createHtmlOutput(

      '<p style="font-family:sans-serif; text-align:center; margin-top:20px;">' +

      '請點擊下方按鈕開啟點餐頁面：<br><br>' +

      '<a href="' +
      WEB_APP_URL +
      '" target="_blank" ' +

      'style="padding:10px 20px; background:#e67e22; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">' +

      '立即開啟點餐系統 🚀' +

      '</a>' +

      '</p>'

    )
    .setWidth(350)
    .setHeight(150);


  SpreadsheetApp
    .getUi()
    .showModalDialog(
      html,
      '呷喀煙燻滷味 - 線上點餐'
    );
}


/**
 * ============================================================
 * 14. 工具：取得 Sheet 第一列欄位名稱
 * ============================================================
 */
function getHeaderInfo_(sheet) {

  var lastColumn =
    sheet.getLastColumn();


  if (lastColumn < 1) {

    return {

      headers: [],

      indexByKey: {}

    };
  }


  var headers =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0];


  var indexByKey = {};


  for (var i = 0; i < headers.length; i++) {

    var key =
      normalizeHeader_(
        headers[i]
      );


    if (key) {

      indexByKey[key] = i;
    }
  }


  return {

    headers:
      headers,

    indexByKey:
      indexByKey
  };
}


/**
 * ============================================================
 * 15. 工具：標準化欄位名稱
 * ============================================================
 */
function normalizeHeader_(value) {

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
 * 16. 工具：設定欄位別名
 * ============================================================
 */
function setFieldAliases_(
  target,
  value,
  aliases
) {

  for (
    var i = 0;
    i < aliases.length;
    i++
  ) {

    target[
      normalizeHeader_(
        aliases[i]
      )
    ] = value;
  }
}


/**
 * ============================================================
 * 17. 工具：依 Header 建立資料列
 * ============================================================
 */
function buildRowByHeaders_(
  headers,
  values
) {

  var row = [];


  for (
    var i = 0;
    i < headers.length;
    i++
  ) {

    var key =
      normalizeHeader_(
        headers[i]
      );


    if (
      key &&
      Object.prototype.hasOwnProperty.call(
        values,
        key
      )
    ) {

      row.push(
        values[key]
      );

    } else {

      row.push("");
    }
  }


  return row;
}


/**
 * ============================================================
 * 18. 工具：依 Header 從資料列取得資料
 * ============================================================
 */
function getValueFromRowByHeaders_(
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
      normalizeHeader_(
        keyNames[i]
      );


    for (
      var j = 0;
      j < headers.length;
      j++
    ) {

      var currentKey =
        normalizeHeader_(
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
 * 19. 工具：從物件取得輸入值
 * ============================================================
 *
 * 支援：
 * camelCase
 * snake_case
 * PascalCase
 * 資料庫欄位名稱
 * ============================================================
 */
function getInputValue_(
  obj,
  keys,
  defaultValue
) {

  if (
    !obj ||
    typeof obj !== "object"
  ) {

    return defaultValue;
  }


  for (
    var i = 0;
    i < keys.length;
    i++
  ) {

    var key =
      keys[i];


    if (
      Object.prototype.hasOwnProperty.call(
        obj,
        key
      )
    ) {

      var value =
        obj[key];


      if (
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {

        return value;
      }


      /**
       * 如果值是 0 或 false
       * 仍然必須保留
       */
      if (
        value === 0 ||
        value === false
      ) {

        return value;
      }
    }
  }


  return defaultValue;
}


/**
 * ============================================================
 * 20. 工具：統一 Boolean
 * ============================================================
 *
 * TRUE / "TRUE" / "true" / 1 / "1" / 是
 * → true
 *
 * 其他
 * → false
 *
 * 這是 Is_Gift 的核心處理。
 * ============================================================
 */
function normalizeBoolean_(value) {

  if (value === true) {
    return true;
  }


  if (value === false) {
    return false;
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


  return (
    str === "true" ||
    str === "1" ||
    str === "yes" ||
    str === "y" ||
    str === "是"
  );
}

/**
 * 現場作業頁 Google 帳號驗證（試用版）
 * tokeninfo 僅適合試用／除錯，正式營運前須改成正式 ID token 簽章驗證。
 */
function handleOperatorAuthPost_(e) {
  var state = "";
  var result;
  try {
    var payload = JSON.parse((e.parameter && (e.parameter.operatorPayload || e.parameter.payload)) || "{}");
    state = String(payload.state || "");
    if (!/^[a-f0-9]{48}$/.test(state)) throw new Error("登入驗證狀態無效。");
    result = verifyOperatorGoogleCredential_(String(payload.credential || ""));
  } catch (err) {
    result = { success: false, message: err && err.message ? err.message : "Google 登入驗證失敗。" };
  }
  if (/^[a-f0-9]{48}$/.test(state)) {
    operatorStoreResponse_(state, { type: "XIAKA_OPERATOR_AUTH", state: state, result: result });
  }
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function operatorStoreResponse_(state, response) {
  if (!/^[a-f0-9]{48}$/.test(String(state || ""))) throw new Error("回覆狀態無效。");
  var cache = CacheService.getScriptCache();
  var json = JSON.stringify(response);
  var chunkSize = 20000;
  var chunkCount = Math.max(1, Math.ceil(json.length / chunkSize));
  var values = {};
  for (var i = 0; i < chunkCount; i++) {
    values["xiaka_op_" + state + "_" + i] = json.slice(i * chunkSize, (i + 1) * chunkSize);
  }
  values["xiaka_op_" + state + "_meta"] = JSON.stringify({ chunkCount: chunkCount });
  cache.putAll(values, 180);
}

function operatorGetCachedResponse_(params) {
  var state = String(params.state || "");
  if (!/^[a-f0-9]{48}$/.test(state)) return { error: "回覆狀態無效。" };
  var cache = CacheService.getScriptCache();
  var metaText = cache.get("xiaka_op_" + state + "_meta");
  if (!metaText) return { pending: true };
  var meta;
  try { meta = JSON.parse(metaText); }
  catch (_) { return { error: "GAS 回覆索引格式錯誤。" }; }
  var mode = String(params.mode || "meta");
  if (mode === "meta") return { ready: true, chunkCount: Number(meta.chunkCount) || 0 };
  if (mode !== "chunk") return { error: "不支援的回覆讀取模式。" };
  var part = Number(params.part);
  if (!Number.isInteger(part) || part < 0 || part >= Number(meta.chunkCount)) return { error: "回覆區塊索引無效。" };
  var chunk = cache.get("xiaka_op_" + state + "_" + part);
  if (chunk === null) return { error: "GAS 暫存回覆已過期，請重新登入。" };
  return { value: chunk };
}

function operatorTextResponse_() {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function verifyOperatorGoogleCredential_(idToken) {
  if (!idToken) throw new Error("沒有收到 Google 登入憑證。");
  var clientId = PropertiesService.getScriptProperties().getProperty("OPERATOR_GOOGLE_CLIENT_ID");
  if (!clientId) throw new Error("GAS 尚未設定 OPERATOR_GOOGLE_CLIENT_ID。");
  var response = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("Google 憑證無效或已過期，請重新登入。");
  var claims = JSON.parse(response.getContentText());
  var validIssuer = claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com";
  var verified = claims.email_verified === true || String(claims.email_verified).toLowerCase() === "true";
  if (!validIssuer || claims.aud !== clientId || !verified || Number(claims.exp) <= Math.floor(Date.now() / 1000) || !claims.email) throw new Error("Google 帳號驗證未通過。");
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Staff_Accounts");
  if (!sheet || sheet.getLastRow() < 2) throw new Error("Staff_Accounts 尚未建立可登入的人員帳號。");
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0].map(function (value) { return String(value).trim(); });
  var col = { id: headers.indexOf("Staff_ID"), sub: headers.indexOf("Google_Subject"), email: headers.indexOf("Google_Email"), name: headers.indexOf("Display_Name"), role: headers.indexOf("Role"), status: headers.indexOf("Status") };
  if (Object.keys(col).some(function (key) { return col[key] < 0; })) throw new Error("Staff_Accounts 欄位標題不完整。");
  var email = String(claims.email).trim().toLowerCase();
  var validRoles = ["系統管理員", "店長", "員工"];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var rowEmail = String(row[col.email] || "").trim().toLowerCase();
    var status = String(row[col.status] || "").trim();
    var subject = String(row[col.sub] || "").trim();
    var role = String(row[col.role] || "").trim();
    if (rowEmail === email && status === "啟用" && validRoles.indexOf(role) >= 0 && (!subject || subject === String(claims.sub || ""))) {
      return { success: true, user: { staffId: String(row[col.id] || ""), email: email, name: String(row[col.name] || claims.name || "").trim(), role: role } };
    }
  }
  throw new Error("此 Google Email 尚未列為啟用中的作業人員，或 Google_Subject 不符。");
}

/**
 * 現場作業頁唯讀資料 API。每次請求都重新驗證 Google ID token，
 * 僅回傳訂單、商品／庫存、營業設定與結算資料，不執行任何寫入。
 */
function handleOperatorReadPost_(e) {
  var state = "";
  var result;
  try {
    var payload = JSON.parse((e.parameter && (e.parameter.operatorPayload || e.parameter.payload)) || "{}");
    state = String(payload.state || "");
    if (!/^[a-f0-9]{48}$/.test(state)) throw new Error("讀取請求狀態無效。");
    var auth = verifyOperatorGoogleCredential_(String(payload.credential || ""));
    if (!auth || !auth.success || !auth.user) throw new Error("帳號驗證失敗。");
    if (payload.action !== "readSnapshot") throw new Error("不支援的唯讀操作。");
    result = { success: true, user: auth.user, data: getOperatorReadSnapshot_() };
  } catch (err) {
    result = { success: false, message: err && err.message ? err.message : "讀取作業資料失敗。" };
  }
  if (/^[a-f0-9]{48}$/.test(state)) {
    operatorStoreResponse_(state, { type: "XIAKA_OPERATOR_READ", state: state, result: result });
  }
  return operatorTextResponse_();
}

/** 作業員訂單狀態／基本資料寫入：每次驗證 Google 身分、角色及 Revision。 */
function handleOperatorWritePost_(e) {
  var state = "";
  var result;
  try {
    var payload = JSON.parse((e.parameter && (e.parameter.operatorPayload || e.parameter.payload)) || "{}");
    state = String(payload.state || "");
    if (!/^[a-f0-9]{48}$/.test(state)) throw new Error("寫入請求狀態無效。");
    var auth = verifyOperatorGoogleCredential_(String(payload.credential || ""));
    if (!auth || !auth.success || !auth.user) throw new Error("帳號驗證失敗。");
    result = updateOperatorOrder_(payload, auth.user);
  } catch (err) {
    result = { success: false, message: err && err.message ? err.message : "更新訂單失敗。" };
  }
  if (/^[a-f0-9]{48}$/.test(state)) {
    operatorStoreResponse_(state, { type: "XIAKA_OPERATOR_WRITE", state: state, result: result });
  }
  return operatorTextResponse_();
}

function updateOperatorOrder_(payload, user) {
  var action = String(payload.action || "");
  var orderId = String(payload.orderId || "").trim();
  var lookupOrderId = orderId;
  var changes = payload.changes || {};
  if (!orderId) throw new Error("缺少訂單編號。");
  if (action === "updateOrderDetails" && ["系統管理員", "店長"].indexOf(user.role) < 0) throw new Error("只有系統管理員或店長可以修改訂單資料。");
  if (["updateOrderStatus", "updateOrderDetails"].indexOf(action) < 0) throw new Error("不支援的訂單操作。");

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss && ss.getSheetByName("Orders");
    if (!sheet || sheet.getLastRow() < 2) throw new Error("找不到 Orders 訂單資料。");
    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(function (value) { return String(value || "").trim(); });
    var col = {};
    headers.forEach(function (header, index) { if (header) col[header] = index; });
    if (col.Order_ID === undefined) throw new Error("Orders 缺少 Order_ID 欄位。");
    var rowIndex = -1;
    for (var i = 1; i < values.length; i++) if (String(values[i][col.Order_ID] || "").trim() === lookupOrderId) { rowIndex = i; break; }
    if (rowIndex < 0 && col.Customer_Order_Code !== undefined) {
      for (var j = 1; j < values.length; j++) if (String(values[j][col.Customer_Order_Code] || "").trim() === lookupOrderId) { rowIndex = j; break; }
    }
    if (rowIndex < 0) throw new Error("找不到這筆訂單，請重新載入清單。");
    var row = values[rowIndex];
    orderId = String(row[col.Order_ID] || "").trim();
    if (col.Work_Status === undefined && col.Order_Status === undefined) throw new Error("Orders 缺少 Work_Status / Order_Status 欄位。");
    var currentRevision = Number(col.Revision === undefined ? 0 : row[col.Revision]) || 0;
    if (currentRevision !== (Number(payload.revision) || 0)) throw new Error("訂單資料已被其他人更新，請重新載入後確認。");
    var before = {};
    headers.forEach(function (header, index) { if (header) before[header] = row[index] instanceof Date ? row[index].toISOString() : row[index]; });

    if (action === "updateOrderStatus") {
      var statusMap = { completed: "已完成", cancelled: "已取消" };
      var nextStatus = statusMap[String(changes.status || "")];
      if (!nextStatus) throw new Error("不支援的訂單狀態。");
      var currentWorkStatus = operatorNormalizeWorkStatus_(col.Work_Status === undefined ? "" : row[col.Work_Status]);
      var currentOrderStatus = operatorNormalizeWorkStatus_(col.Order_Status === undefined ? "" : row[col.Order_Status]);
      if (["completed", "cancelled"].indexOf(currentWorkStatus) >= 0 || ["completed", "cancelled"].indexOf(currentOrderStatus) >= 0) throw new Error("此訂單已完成或取消，不能再次變更狀態。");
      if (col.Work_Status !== undefined) row[col.Work_Status] = nextStatus;
      if (col.Order_Status !== undefined) row[col.Order_Status] = nextStatus;
    } else {
      var dateValue = String(changes.pickupDate || "").trim();
      var timeValue = String(changes.pickupTime || "").trim();
      var nameValue = String(changes.name || "").trim();
      var phoneValue = String(changes.phone || "").trim();
      var amountValue = Number(changes.amount);
      if (!dateValue || isNaN(Date.parse(dateValue)) || !nameValue || !phoneValue || !isFinite(amountValue) || amountValue < 0) throw new Error("日期、姓名、電話或金額格式不正確。");
      var fields = { Pickup_Date: new Date(dateValue + "T12:00:00+08:00"), Pickup_Time_Slot: timeValue, Customer_Name: nameValue, Customer_Phone: operatorPhoneWithLeadingZero_(phoneValue), Total_Amount: amountValue, Remarks: String(changes.remarks || "").trim() };
      Object.keys(fields).forEach(function (key) { if (col[key] !== undefined) row[col[key]] = fields[key]; });
      if (col.Customer_Phone !== undefined) sheet.getRange(rowIndex + 1, col.Customer_Phone + 1).setNumberFormat("@");
    }
    operatorEnsureOrderAuditSheet_(ss);
    if (col.Revision !== undefined) row[col.Revision] = currentRevision + 1;
    if (col.Updated_At !== undefined) row[col.Updated_At] = new Date();
    if (col.Updated_By !== undefined) row[col.Updated_By] = user.name || user.email;
    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([row]);
    var after = {};
    headers.forEach(function (header, index) { if (header) after[header] = row[index] instanceof Date ? row[index].toISOString() : row[index]; });
    operatorAppendOrderAudit_(ss, orderId, action === "updateOrderStatus" ? "更新訂單狀態" : "修改訂單", before, after, user, stateRequestId_(payload));
    return { success: true, revision: currentRevision + 1 };
  } finally {
    lock.releaseLock();
  }
}

function stateRequestId_(payload) { return String(payload.state || ""); }

function operatorAppendOrderAudit_(ss, orderId, action, before, after, user, requestId) {
  var sheet = operatorEnsureOrderAuditSheet_(ss);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (value) { return String(value || "").trim(); });
  var values = { Audit_ID: Utilities.getUuid(), Order_ID: orderId, Action: action, Before_JSON: JSON.stringify(before), After_JSON: JSON.stringify(after), Actor_ID: user.staffId || user.email, Actor_Name: user.name || user.email, Created_At: new Date(), Request_ID: requestId };
  var row = headers.map(function (header) { return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : ""; });
  sheet.appendRow(row);
}

/** 建立或補齊訂單異動紀錄表頭，不清除既有資料或欄位。 */
function operatorEnsureOrderAuditSheet_(ss) {
  var sheet = ss.getSheetByName("Order_Audit_Log");
  if (!sheet) sheet = ss.insertSheet("Order_Audit_Log");
  var required = ["Audit_ID", "Order_ID", "Action", "Before_JSON", "After_JSON", "Actor_ID", "Actor_Name", "Created_At", "Request_ID"];
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) { return String(value || "").trim(); });
  var missing = required.filter(function (header) { return existing.indexOf(header) < 0; });
  if (missing.length) sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
  sheet.setFrozenRows(1);
  return sheet;
}

function getOperatorReadSnapshot_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("無法取得此 GAS 綁定的試算表。");

  var orderItemsById = {};
  operatorReadRows_(ss, "OrderItems").forEach(function (row) {
    var orderId = String(row.Order_ID || "").trim();
    if (!orderId || orderId === "訂單編號") return;
    if (!orderItemsById[orderId]) orderItemsById[orderId] = [];
    var name = String(row.Item_Name || row.Online_Name || row.Product_ID || "商品").trim();
    var qty = Number(row.Quantity) || 0;
    var unitPrice = Number(row.Unit_Price) || 0;
    var lineTotal = Number(row.Line_Total || row.Subtotal) || unitPrice * qty;
    orderItemsById[orderId].push(name + " × " + qty + (unitPrice ? "（單價 " + unitPrice + "，小計 " + lineTotal + "）" : ""));
  });

  var orders = operatorReadRows_(ss, "Orders").map(function (row) {
    var orderId = String(row.Order_ID || "").trim();
    if (!orderId || orderId === "訂單編號") return null;
    var workStatus = String(row.Work_Status || "").trim();
    var orderStatus = String(row.Order_Status || "").trim();
    var normalizedWorkStatus = operatorNormalizeWorkStatus_(workStatus);
    var normalizedOrderStatus = operatorNormalizeWorkStatus_(orderStatus);
    var status = workStatus ? normalizedWorkStatus : normalizedOrderStatus;
    // 取消或完成是終態，即使兩個欄位有舊值不一致，也讓分類顯示終態。
    if (normalizedWorkStatus === "cancelled" || normalizedOrderStatus === "cancelled") {
      status = "cancelled";
    } else if (normalizedWorkStatus === "completed" || normalizedOrderStatus === "completed") {
      status = "completed";
    }
    var extraDetails = [];
    var localizedOrderFields = [
      { key: "Overall_Pepper", aliases: ["Pepper", "整單胡椒鹽(不加/小/中/大)", "整單胡椒鹽"], label: "整單胡椒鹽(不加/小/中/大)" },
      { key: "Overall_Chili_Powder", aliases: ["Chili_Powder", "整單辣椒粉(不加/小/中/大)", "整單辣椒粉"], label: "整單辣椒粉(不加/小/中/大)" },
      { key: "Overall_Chili_Sauce", aliases: ["Chili_Sauce", "整單辣醬(要/不加)", "整單辣醬"], label: "整單辣醬(要/不加)" },
      { key: "Veg_Separate", aliases: ["蔬菜分裝選項", "蔬菜分裝"], label: "蔬菜分裝選項" },
      { key: "Extra_Pepper_Pack", aliases: ["胡椒鹽夾鏈包數量"], label: "胡椒鹽夾鏈包數量" },
      { key: "Extra_Chili_Pack", aliases: ["辣椒粉夾鏈包數量"], label: "辣椒粉夾鏈包數量" },
      { key: "Extra_Sauce_Pack", aliases: ["辣醬夾鏈包數量"], label: "辣醬夾鏈包數量" },
      { key: "Discount_Amount", aliases: ["折扣金額NT$", "折扣金額"], label: "折扣金額NT$" },
      { key: "Order_Type", aliases: ["取餐類型"], label: "取餐類型" }
    ];
    var localizedFieldKeys = [];
    localizedOrderFields.forEach(function (field) {
      localizedFieldKeys.push(field.key);
      field.aliases.forEach(function (alias) { localizedFieldKeys.push(alias); });
      var value = row[field.key];
      if (value === "" || value === null || value === undefined) {
        for (var a = 0; a < field.aliases.length; a++) {
          var aliasValue = row[field.aliases[a]];
          if (aliasValue !== "" && aliasValue !== null && aliasValue !== undefined) { value = aliasValue; break; }
        }
      }
      if (value === "" || value === null || value === undefined) return;
      if (value instanceof Date) value = operatorFormatDate_(value, "yyyy-MM-dd HH:mm");
      extraDetails.push({ label: field.label, value: String(value) });
    });
    var coreOrderFields = ["Order_ID", "Customer_Order_Code", "Order_Time", "Pickup_Date", "Pickup_Time_Slot", "Customer_Name", "Customer_Phone", "Total_Amount", "Payment_Status", "Work_Status", "Order_Status", "Remarks", "Revision"];
    Object.keys(row).forEach(function (key) {
      if (coreOrderFields.indexOf(key) >= 0 || localizedFieldKeys.indexOf(key) >= 0) return;
      var value = row[key];
      if (value === "" || value === null || value === undefined) return;
      if (value instanceof Date) value = operatorFormatDate_(value, "yyyy-MM-dd HH:mm");
      extraDetails.push({ label: key, value: String(value) });
    });
    return {
      id: String(row.Customer_Order_Code || orderId),
      systemId: orderId,
      orderTime: operatorFormatDate_(row.Order_Time, "yyyy-MM-dd HH:mm"),
      pickupDate: operatorFormatDate_(row.Pickup_Date, "yyyy-MM-dd"),
      pickupTime: String(row.Pickup_Time_Slot || ""),
      name: String(row.Customer_Name || ""),
      phone: operatorPhoneWithLeadingZero_(row.Customer_Phone),
      amount: Number(row.Total_Amount) || 0,
      payment: String(row.Payment_Status || ""),
      status: status,
      items: orderItemsById[orderId] || [],
      extraDetails: extraDetails,
      remarks: String(row.Remarks || ""),
      revision: Number(row.Revision) || 0
    };
  }).filter(function (row) { return !!row; });

  var products = operatorReadRows_(ss, "Products").map(function (row) {
    var id = String(row.Product_ID || "").trim();
    if (!id || id === "品項編號" || id === "商品編號") return null;
    var stock = Number(row.Stock_Qty) || 0;
    var reserved = Number(row.Reserved_Qty) || 0;
    var manualStatus = String(row.Manual_Listing_Status || "").trim();
    return {
      id: id,
      name: String(row.Online_Name || row.Item_Name || id),
      quantity: Math.max(0, stock - reserved),
      stockQty: stock,
      reservedQty: reserved,
      manualHidden: manualStatus === "手動下架",
      listingStatus: String(row.Status || ""),
      rating: String(row.Rating || ""),
      description: String(row.Description || "")
    };
  }).filter(function (row) { return !!row; });

  var settingRows = operatorReadRows_(ss, "Settings");
  var settingsMap = {};
  settingRows.forEach(function (row) {
    if (row.Setting_Key) settingsMap[String(row.Setting_Key).trim()] = row.Setting_Value;
  });
  var statusValue = String(settingsMap.Store_Status || "OPEN").trim().toUpperCase();
  var businessDays = String(settingsMap.Business_Days || "MON,TUE,WED,THU,FRI,SAT,SUN")
    .toUpperCase().split(/[\s,，]+/).filter(function (day) { return !!day; });

  var pickupSlots = operatorReadRows_(ss, "Pickup_Slots").map(function (row) {
    if (String(row.Pickup_Date || "") === "取餐日期") return null;
    var startTime = operatorFormatTime_(row.Start_Time);
    var endTime = operatorFormatTime_(row.End_Time);
    if (!startTime) return null;
    return {
      date: operatorFormatDate_(row.Pickup_Date, "yyyy-MM-dd"),
      time: startTime + (endTime ? "–" + endTime : ""),
      enabled: row.Is_Enabled === true || ["TRUE", "1", "是", "開放"].indexOf(String(row.Is_Enabled).toUpperCase()) >= 0
    };
  }).filter(function (row) { return !!row; });

  var businessCalendar = operatorReadRows_(ss, "Business_Calendar").map(function (row) {
    var date = operatorFormatDate_(row.Business_Date, "yyyy-MM-dd");
    if (!date || date === "營業日期") return null;
    var businessType = String(row.Business_Type || "").trim().toUpperCase();
    var closedValue = String(row.Is_Closed || "").trim().toUpperCase();
    var closed = businessType === "CLOSED" || (!businessType && (row.Is_Closed === true || ["TRUE", "1", "是", "休息"].indexOf(closedValue) >= 0));
    return {
      date: date,
      businessType: businessType || (closed ? "CLOSED" : "SPECIAL_OPEN"),
      closed: closed,
      openTime: operatorFormatTime_(row.Order_Open_Time),
      closeTime: operatorFormatTime_(row.Order_Close_Time),
      pickupStartTime: operatorFormatTime_(row.Pickup_Start_Time),
      pickupEndTime: operatorFormatTime_(row.Pickup_End_Time),
      pickupIntervalMinutes: Number(row.Pickup_Slot_Interval_Minutes) || null,
      note: String(row.Note || row.Special_Note || "")
    };
  }).filter(function (row) { return !!row; });

  var settlements = {};
  operatorReadRows_(ss, "Daily_Settlements").forEach(function (row) {
    var date = operatorFormatDate_(row.Settlement_Date, "yyyy-MM-dd");
    if (!date || date === "結算日期") return;
    var rawStatus = String(row.Status || "").trim();
    var settlementStatus = rawStatus.indexOf("已結算") >= 0 || rawStatus.toLowerCase() === "closed"
      ? "closed"
      : (rawStatus.indexOf("重開") >= 0 || rawStatus.toLowerCase() === "reopened" ? "reopened" : "draft");
    settlements[date] = {
      date: date,
      status: settlementStatus,
      cashSales: Number(row.Cash_Sales_Amount) || 0,
      floatAmount: Number(row.Opening_Float) || 0,
      countedCash: Number(row.Counted_Cash) || 0,
      note: String(row.Notes || ""),
      updatedAt: operatorFormatDate_(row.Closed_At || row.Created_At, "yyyy-MM-dd HH:mm"),
      actor: String(row.Closed_By || row.Created_By || ""),
      inventoryCounts: {}
    };
  });

  operatorReadRows_(ss, "Settlement_Inventory_Counts").forEach(function (row) {
    var date = operatorFormatDate_(row.Settlement_Date, "yyyy-MM-dd");
    var productId = String(row.Product_ID || "").trim();
    if (!date || date === "盤點日期" || !productId) return;
    if (!settlements[date]) settlements[date] = { date: date, status: "draft", inventoryCounts: {} };
    settlements[date].inventoryCounts[productId] = Number(row.Counted_Qty) || 0;
  });

  return {
    orders: orders,
    products: products,
    settings: {
      closed: statusValue === "CLOSED",
      businessDays: businessDays,
      openTime: operatorFormatTime_(settingsMap.Auto_Open_Time),
      closeTime: operatorFormatTime_(settingsMap.Auto_Close_Time),
      pickupStartTime: operatorFormatTime_(settingsMap.Pickup_Start_Time),
      pickupEndTime: operatorFormatTime_(settingsMap.Pickup_End_Time),
      pickupIntervalMinutes: Number(settingsMap.Pickup_Slot_Interval_Minutes) || 30,
      disabledSlots: String(settingsMap.Disabled_Time_Slots || "").split(",").map(function (slot) { return slot.trim(); }).filter(Boolean),
      note: String(settingsMap.Special_Note || "")
    },
    businessCalendar: businessCalendar,
    pickupSlots: pickupSlots,
    settlements: settlements
  };
}

function operatorReadRows_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (value) { return String(value || "").trim(); });
  return values.slice(1).map(function (cells) {
    var row = {};
    headers.forEach(function (header, index) { if (header) row[header] = cells[index]; });
    return row;
  }).filter(function (row) { return Object.keys(row).some(function (key) { return row[key] !== "" && row[key] !== null; }); });
}

function operatorNormalizeWorkStatus_(value) {
  var status = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (["準備中", "preparing", "製作中", "inprogress", "in_progress"].indexOf(status) >= 0) return "preparing";
  if (["已完成", "完成", "completed", "complete", "done"].indexOf(status) >= 0) return "completed";
  if (["已取消", "取消", "取消訂單", "訂單已取消", "cancelled", "canceled"].indexOf(status) >= 0) return "cancelled";
  return "pending";
}

function operatorFormatDate_(value, pattern) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, "Asia/Taipei", pattern);
  return String(value || "").trim();
}

/** 一次性整理 Orders.Customer_Phone：以純文字存放並補回遺失的手機開頭 0。 */
function fixCustomerPhoneLeadingZeros() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName("Orders");
  if (!sheet || sheet.getLastRow() < 1) throw new Error("找不到 Orders 工作表或標題列。");
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (value) { return String(value || "").trim(); });
  var phoneColumn = headers.indexOf("Customer_Phone");
  if (phoneColumn < 0) phoneColumn = headers.indexOf("客戶電話");
  if (phoneColumn < 0) throw new Error("Orders 工作表找不到 Customer_Phone 欄位。");
  if (sheet.getLastRow() < 2) return "沒有訂單資料需要修正。";
  var range = sheet.getRange(2, phoneColumn + 1, sheet.getLastRow() - 1, 1);
  var values = range.getValues();
  var changed = 0;
  var fixed = values.map(function (row) {
    var original = row[0];
    var normalized = operatorPhoneWithLeadingZero_(original);
    if (String(original === null || original === undefined ? "" : original) !== normalized) changed++;
    return [normalized];
  });
  range.setNumberFormat("@");
  range.setValues(fixed);
  return "已將 Customer_Phone 設為純文字並補回 " + changed + " 筆手機號碼的開頭 0。";
}

function operatorPhoneWithLeadingZero_(value) {
  if (value === null || value === undefined || value === "") return "";
  var phone = String(value).trim().replace(/^'/, "");
  var digits = phone.replace(/\D/g, "");
  if (/^9\d{8}$/.test(digits)) return "0" + digits;
  if (/^8869\d{8}$/.test(digits)) return "0" + digits.slice(3);
  return phone;
}

function operatorFormatTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, "Asia/Taipei", "HH:mm");
  if (typeof value === "number" && value >= 0 && value < 1) {
    var minutes = Math.round(value * 1440);
    return ("0" + Math.floor(minutes / 60)).slice(-2) + ":" + ("0" + (minutes % 60)).slice(-2);
  }
  return String(value || "").trim();
}

function authorizeUrlFetchForOperator() {
  UrlFetchApp.fetch("https://www.googleapis.com", {
    muteHttpExceptions: true
  });
}
