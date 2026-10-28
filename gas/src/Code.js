
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

      if (apiName === "operatorPoll") {
        result = operatorPollResponse_(e.parameter.state, e.parameter.mode, e.parameter.part);

      } else if (apiName === "products") {
        result = getProductsForFrontend();

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

      var jsonpPayload = JSON.stringify(result).replace(/</g, "\\u003c");
      return ContentService
        .createTextOutput(
          callback + "(" + jsonpPayload + ");"
        )
        .setMimeType(ContentService.MimeType.JAVASCRIPT);

    } catch (error) {

      var errorResult = {
        success: false,
        message: error.message
      };

      var errorJsonpPayload = JSON.stringify(errorResult).replace(/</g, "\\u003c");
      return ContentService
        .createTextOutput(
          callback + "(" + errorJsonpPayload + ");"
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
      phone,
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
 * 每日循環產生客戶查詢編號：A~E + 台北時間 HHmm + 電話末三碼。
 * saveOrderData_ 會先取得 ScriptLock，確保同時下單時流水號不重複。
 */
function generateCustomerOrderCode_(now, phone, todayStr) {
  var phoneDigits = String(phone || "").replace(/\D/g, "");
  if (phoneDigits.length < 3) {
    throw new Error("無法建立客戶訂單編號：電話號碼不足三碼。");
  }

  var properties = PropertiesService.getScriptProperties();
  var savedDate = properties.getProperty("CUSTOMER_ORDER_CODE_DATE");
  var sequenceIndex = savedDate === todayStr
    ? Number(properties.getProperty("CUSTOMER_ORDER_CODE_NEXT_INDEX"))
    : 0;

  if (!isFinite(sequenceIndex) || sequenceIndex < 0 || sequenceIndex > 4) {
    sequenceIndex = 0;
  }

  var letter = String.fromCharCode(65 + sequenceIndex);
  properties.setProperties({
    CUSTOMER_ORDER_CODE_DATE: todayStr,
    CUSTOMER_ORDER_CODE_NEXT_INDEX: String((sequenceIndex + 1) % 5)
  });

  return letter +
    Utilities.formatDate(now, "Asia/Taipei", "HHmm") +
    phoneDigits.slice(-3);
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

      var storedPhone = String(
        getValueFromRowByHeaders_(
          row,
          ordersHeaders,
          ["Customer_Phone", "客戶電話"],
          ""
        )
      )
        .trim()
        .replace(/^'/, "")
        .replace(/[\s-]/g, "");

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

  if (e && e.parameter && e.parameter.operatorRead === "1") {
    return handleOperatorReadPost_(e);
  }

  // 現場作業頁 Google 登入請求；其他 POST 維持原有訂單處理流程。
  if (e && e.parameter && e.parameter.operatorAuth === "1") {
    return handleOperatorAuthPost_(e);
  }

  if (e && e.parameter && e.parameter.operatorWrite === "1") {
    return handleOperatorWritePost_(e);
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

  var ss =
    SpreadsheetApp.getActiveSpreadsheet();

  var sheet =
    ss.getSheetByName("Settings");


  if (!sheet) {

    return {

      openTime: "16:00",

      closeTime: "21:30",

      disabledSlots: []

    };
  }


  var data =
    sheet
      .getDataRange()
      .getValues();


  var openTime = "16:00";

  var closeTime = "21:30";

  var disabledSlots = [];


  for (var i = 0; i < data.length; i++) {

    var key =
      String(
        data[i][0] || ""
      )
      .trim()
      .toLowerCase();


    var val =
      data[i][1];


    if (
      (
        key === "auto_open_time" ||
        key === "open_time"
      ) &&
      val !== ""
    ) {

      openTime =
        parseTimeString(
          val,
          "16:00"
        );
    }


    if (
      (
        key === "auto_close_time" ||
        key === "close_time"
      ) &&
      val !== ""
    ) {

      closeTime =
        parseTimeString(
          val,
          "21:30"
        );
    }


    if (
      key === "disabled_time_slots" &&
      val
    ) {

      disabledSlots =
        String(val).split(",");
    }
  }


  return {

    openTime:
      openTime,

    closeTime:
      closeTime,

    disabledSlots:
      disabledSlots
  };
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
  var origin = "https://red-k-heart.github.io";
  var result;
  try {
    var payload = JSON.parse((e.parameter && (e.parameter.operatorPayload || e.parameter.payload)) || "{}");
    state = String(payload.state || "");
    if (!/^[a-f0-9]{48}$/.test(state)) throw new Error("登入驗證狀態無效。");
    result = verifyOperatorGoogleCredential_(String(payload.credential || ""));
  } catch (err) {
    result = { success: false, message: err && err.message ? err.message : "Google 登入驗證失敗。" };
  }
  operatorStoreResponse_(state, { type: "XIAKA_OPERATOR_AUTH", state: state, result: result });
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
  var origin = "https://red-k-heart.github.io";
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
  operatorStoreResponse_(state, { type: "XIAKA_OPERATOR_READ", state: state, result: result });
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

/**
 * 此版本尚未實作訂單／營業設定寫入；回傳結構化錯誤，避免前端輪詢逾時。
 */
function handleOperatorWritePost_(e) {
  var payload = {};
  try { payload = JSON.parse((e.parameter && (e.parameter.operatorPayload || e.parameter.payload)) || "{}"); } catch (_) {}
  var state = String(payload.state || "");
  if (!/^[a-f0-9]{48}$/.test(state)) return ContentService.createTextOutput("Invalid operator state").setMimeType(ContentService.MimeType.TEXT);
  operatorStoreResponse_(state, {
    type: "XIAKA_OPERATOR_WRITE",
    state: state,
    result: { success: false, message: "目前 GAS 版本尚未開放此項寫入功能；資料沒有變更。" }
  });
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

/**
 * 將 POST 的回覆暫存，供前端以 JSONP 分段輪詢取得。
 * state 由前端使用 48 位十六進位隨機值產生；快取期限短，避免回覆長期留存。
 */
function operatorStoreResponse_(state, message) {
  state = String(state || "");
  if (!/^[a-f0-9]{48}$/.test(state)) throw new Error("作業頁回覆狀態無效。");
  var serialized = JSON.stringify(message);
  var chunkSize = 7000;
  var chunks = [];
  for (var start = 0; start < serialized.length;) {
    var end = Math.min(start + chunkSize, serialized.length);
    // 不要把 UTF-16 surrogate pair 切成兩段，避免中文字以外的符號損壞。
    if (end < serialized.length && end > start) {
      var lastCode = serialized.charCodeAt(end - 1);
      if (lastCode >= 0xD800 && lastCode <= 0xDBFF) end--;
    }
    chunks.push(serialized.slice(start, end));
    start = end;
  }
  if (chunks.length < 1 || chunks.length > 500) throw new Error("作業頁回覆資料過大，無法暫存。");
  var cache = CacheService.getScriptCache();
  var prefix = "operator:" + state + ":";
  for (var i = 0; i < chunks.length; i++) cache.put(prefix + "chunk:" + i, chunks[i], 180);
  cache.put(prefix + "meta", JSON.stringify({ ready: true, chunkCount: chunks.length }), 180);
}

function operatorPollResponse_(state, mode, part) {
  state = String(state || "");
  mode = String(mode || "");
  if (!/^[a-f0-9]{48}$/.test(state)) return { error: "作業頁回覆狀態無效。" };
  var cache = CacheService.getScriptCache();
  var prefix = "operator:" + state + ":";
  if (mode === "meta") {
    var meta = cache.get(prefix + "meta");
    return meta ? JSON.parse(meta) : { pending: true };
  }
  if (mode === "chunk") {
    var index = Number(part);
    if (!Number.isInteger(index) || index < 0 || index >= 500) return { error: "回覆分段編號無效。" };
    var chunk = cache.get(prefix + "chunk:" + index);
    return chunk === null ? { pending: true } : { value: chunk };
  }
  return { error: "不支援的作業頁輪詢模式。" };
}

function getOperatorReadSnapshot_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("無法取得此 GAS 綁定的試算表。");

  var orderItemsById = {};
  operatorReadRows_(ss, "OrderItems").forEach(function (row) {
    var orderId = String(row.Order_ID || "").trim();
    if (!orderId || orderId === "訂單編號") return;
    if (!orderItemsById[orderId]) orderItemsById[orderId] = [];
    var name = String(row.Item_Name || row.Product_ID || "商品").trim();
    var qty = Number(row.Quantity) || 0;
    orderItemsById[orderId].push(name + " × " + qty);
  });

  var orders = operatorReadRows_(ss, "Orders").map(function (row) {
    var orderId = String(row.Order_ID || "").trim();
    if (!orderId || orderId === "訂單編號") return null;
    var workStatus = String(row.Work_Status || row.Order_Status || "").trim();
    var status = operatorNormalizeWorkStatus_(workStatus);
    return {
      id: String(row.Customer_Order_Code || orderId),
      systemId: orderId,
      orderTime: operatorFormatDate_(row.Order_Time, "yyyy-MM-dd HH:mm"),
      pickupDate: operatorFormatDate_(row.Pickup_Date, "yyyy-MM-dd"),
      pickupTime: String(row.Pickup_Time_Slot || ""),
      name: String(row.Customer_Name || ""),
      phone: String(row.Customer_Phone || ""),
      amount: Number(row.Total_Amount) || 0,
      payment: String(row.Payment_Status || ""),
      status: status,
      items: orderItemsById[orderId] || [],
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

  var pickupSlots = operatorReadRows_(ss, "Pickup_Slots").map(function (row) {
    if (String(row.Pickup_Date || "") === "取餐日期") return null;
    return {
      date: operatorFormatDate_(row.Pickup_Date, "yyyy-MM-dd"),
      time: String(row.Start_Time || "") + (row.End_Time ? "–" + String(row.End_Time) : ""),
      enabled: row.Is_Enabled === true || ["TRUE", "1", "是", "開放"].indexOf(String(row.Is_Enabled).toUpperCase()) >= 0
    };
  }).filter(function (row) { return !!row; });

  var businessCalendar = operatorReadRows_(ss, "Business_Calendar").map(function (row) {
    var date = operatorFormatDate_(row.Business_Date, "yyyy-MM-dd");
    if (!date || date === "營業日期") return null;
    var closedValue = String(row.Is_Closed || "").trim().toUpperCase();
    return {
      date: date,
      closed: row.Is_Closed === true || ["TRUE", "1", "是", "休息"].indexOf(closedValue) >= 0,
      openTime: operatorFormatTime_(row.Order_Open_Time),
      closeTime: operatorFormatTime_(row.Order_Close_Time),
      note: String(row.Special_Note || "")
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
      openTime: operatorFormatTime_(settingsMap.Auto_Open_Time),
      closeTime: operatorFormatTime_(settingsMap.Auto_Close_Time),
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
  var status = String(value || "").trim();
  if (status === "準備中") return "preparing";
  if (status === "已完成" || status === "完成") return "completed";
  if (status === "已取消" || status === "取消") return "cancelled";
  return "pending";
}

function operatorFormatDate_(value, pattern) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, "Asia/Taipei", pattern);
  return String(value || "").trim();
}

function operatorFormatTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, "Asia/Taipei", "HH:mm");
  if (typeof value === "number" && value >= 0 && value < 1) {
    var minutes = Math.round(value * 1440);
    return ("0" + Math.floor(minutes / 60)).slice(-2) + ":" + ("0" + (minutes % 60)).slice(-2);
  }
  return String(value || "").trim();
}
